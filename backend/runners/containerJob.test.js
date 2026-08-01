// Unit tests for the container-job engine (feat-runner-swift-spm-001).
// Everything except the real Docker daemon: log demuxing, the in-container
// script, marker extraction, name/endpoint derivation, and the full
// create→start→wait→logs→remove orchestration with an injected transport.

const test = require('node:test');
const assert = require('node:assert');
const {
  engineTarget, demuxDockerLogs, buildJobScript, extractMarkedReport,
  jobName, runContainerJob, JOB_PREFIX, REPORT_BEGIN, REPORT_END,
} = require('./containerJob');

// --- engineTarget ---------------------------------------------------------

test('DOCKER_HOST http/tcp wins and parses host:port', () => {
  assert.deepStrictEqual(
    engineTarget({ DOCKER_HOST: 'http://docker-socket-proxy:2375' }),
    { host: 'docker-socket-proxy', port: 2375 }
  );
  assert.deepStrictEqual(
    engineTarget({ DOCKER_HOST: 'tcp://10.0.0.5:12375' }),
    { host: '10.0.0.5', port: 12375 }
  );
});

test('platform defaults: windows named pipe, posix socket', () => {
  assert.deepStrictEqual(engineTarget({ ATRIUM_PLATFORM: 'win32' }), { socketPath: '\\\\.\\pipe\\docker_engine' });
  assert.deepStrictEqual(engineTarget({ ATRIUM_PLATFORM: 'linux' }), { socketPath: '/var/run/docker.sock' });
});

// --- demuxDockerLogs ------------------------------------------------------

function frame(streamType, text) {
  const payload = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header[0] = streamType;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

test('demux: multiplexed stdout+stderr frames interleave in order', () => {
  const buf = Buffer.concat([frame(1, 'out-1\n'), frame(2, 'err-1\n'), frame(1, 'out-2\n')]);
  assert.strictEqual(demuxDockerLogs(buf), 'out-1\nerr-1\nout-2\n');
});

test('demux: plain (TTY) streams pass through untouched', () => {
  const plain = Buffer.from('just plain text\nwith lines\n');
  assert.strictEqual(demuxDockerLogs(plain), 'just plain text\nwith lines\n');
});

test('demux: empty and truncated-final-frame inputs are safe', () => {
  assert.strictEqual(demuxDockerLogs(Buffer.alloc(0)), '');
  const truncated = Buffer.concat([frame(1, 'ok'), Buffer.from([1, 0, 0, 0])]);
  assert.strictEqual(demuxDockerLogs(truncated), 'ok');
});

// --- buildJobScript -------------------------------------------------------

test('script copies /src CONTENTS to /work, preserves exit code, and prints markers', () => {
  const s = buildJobScript('swift test --xunit-output junit.xml', 'junit.xml');
  // Contents copy (`/src/.`) — WorkingDir pre-creates /work, so a plain
  // `cp -r /src /work` would nest the tree at /work/src.
  assert.match(s, /cp -a \/src\/\. \/work\/ && cd \/work/);
  assert.match(s, /\(swift test --xunit-output junit\.xml\)/);
  assert.match(s, /status=\$\?/);
  assert.ok(s.includes(REPORT_BEGIN));
  assert.ok(s.includes(REPORT_END));
  assert.match(s, /exit \$status/);
});

test('script without a reportPath emits no markers', () => {
  const s = buildJobScript('make check', null);
  assert.ok(!s.includes(REPORT_BEGIN));
  assert.match(s, /exit \$status/);
});

test('single quotes are stripped from the report path (shell-quoting safety)', () => {
  const s = buildJobScript('x', "ju'nit.xml");
  assert.ok(!s.includes("ju'nit"));
});

// --- extractMarkedReport --------------------------------------------------

test('extract: report between markers, output keeps the surrounding logs', () => {
  const logs = `building...\n${REPORT_BEGIN}\n<testsuite><testcase name="t"/></testsuite>\n${REPORT_END}\ndone\n`;
  const { report, output } = extractMarkedReport(logs);
  assert.strictEqual(report, '<testsuite><testcase name="t"/></testsuite>');
  assert.match(output, /building\.\.\./);
  assert.match(output, /done/);
  assert.ok(!output.includes('<testsuite>'));
});

test('extract: no markers → report null, output untouched', () => {
  const { report, output } = extractMarkedReport('compile error\n');
  assert.strictEqual(report, null);
  assert.strictEqual(output, 'compile error\n');
});

// --- jobName --------------------------------------------------------------

test('job names live in the atrium-job-* namespace and sanitize the task id', () => {
  const n = jobName('feat-swift/Weird ID-001');
  assert.ok(n.startsWith(JOB_PREFIX));
  assert.match(n, /^atrium-job-[a-z0-9_.-]+$/);
});

// --- runContainerJob orchestration ---------------------------------------

function fakeDocker({ exitCode = 0, logsText = '', failStart = false } = {}) {
  const calls = [];
  const request = async ({ method, path: p, raw }) => {
    calls.push(`${method} ${p.split('?')[0]}`);
    if (p.startsWith('/containers/create')) return { Id: 'abc' };
    if (p.endsWith('/start')) {
      if (failStart) throw new Error('boom on start');
      return null;
    }
    if (p.endsWith('/wait')) return { StatusCode: exitCode };
    if (p.includes('/logs')) return raw ? Buffer.from(logsText) : logsText;
    if (method === 'DELETE') return null;
    throw new Error(`unexpected ${method} ${p}`);
  };
  return { calls, request };
}

test('happy path: create→start→wait→logs→remove, report extracted, exit code kept', async () => {
  const logs = `ok\n${REPORT_BEGIN}\n<testsuite><testcase name="a"/></testsuite>\n${REPORT_END}\n`;
  const fake = fakeDocker({ exitCode: 3, logsText: logs });
  const result = await runContainerJob(
    { image: 'swift:6.0', command: 'swift test', cwd: 'C:\\proj', reportPath: 'junit.xml', taskId: 'feat-x-001' },
    { dockerRequest: fake.request, jobName: 'atrium-job-fixed' }
  );
  assert.strictEqual(result.exitCode, 3);
  assert.match(result.report, /<testsuite>/);
  assert.deepStrictEqual(fake.calls, [
    'POST /containers/create',
    'POST /containers/atrium-job-fixed/start',
    'POST /containers/atrium-job-fixed/wait',
    'GET /containers/atrium-job-fixed/logs',
    'DELETE /containers/atrium-job-fixed',
  ]);
});

test('start failure still fetches logs, still removes, and surfaces the error in output', async () => {
  const fake = fakeDocker({ failStart: true, logsText: '' });
  const result = await runContainerJob(
    { image: 'swift:6.0', command: 'swift test', cwd: '/p', reportPath: 'junit.xml', taskId: 't' },
    { dockerRequest: fake.request, jobName: 'atrium-job-fixed' }
  );
  assert.strictEqual(result.exitCode, -1);
  assert.match(result.output, /boom on start/);
  assert.ok(fake.calls.includes('DELETE /containers/atrium-job-fixed'), 'container must be removed');
});

test('create body: ro bind of the suite cwd, bridge network, bash -lc script', async () => {
  let createBody = null;
  const request = async ({ method, path: p, body, raw }) => {
    if (p.startsWith('/containers/create')) { createBody = body; return {}; }
    if (p.endsWith('/wait')) return { StatusCode: 0 };
    if (p.includes('/logs')) return raw ? Buffer.alloc(0) : '';
    return null;
  };
  await runContainerJob(
    { image: 'swift:6.0', command: 'swift test', cwd: 'C:\\Users\\x\\proj', reportPath: 'junit.xml', taskId: 't' },
    { dockerRequest: request, jobName: 'atrium-job-fixed' }
  );
  assert.strictEqual(createBody.Image, 'swift:6.0');
  assert.deepStrictEqual(createBody.HostConfig.Binds, ['C:/Users/x/proj:/src:ro']);
  assert.strictEqual(createBody.HostConfig.NetworkMode, 'bridge');
  assert.strictEqual(createBody.Cmd[0], 'bash');
  assert.strictEqual(createBody.Cmd[1], '-lc');
  assert.match(createBody.Cmd[2], /cp -a \/src\/\. \/work\//);
});
