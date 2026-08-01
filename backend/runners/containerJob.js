// Container-target job execution (feat-runner-swift-spm-001).
//
// Runs a suite's command in an ephemeral Docker container — the mechanism
// behind `target: "container:<image>"` in atrium.tests.json. Swift tier 1
// (`swift test --xunit-output` in swift:6) is the flagship consumer, but the
// engine is image-agnostic: any allowlisted image + junit-emitting command
// works. (The task card named this swiftSpm.js; the file is named for what it
// is — the Swift specifics are configuration + docs, not code.)
//
// The flow uses EXACTLY the five shapes the socket allow-list proxy grants
// (devops-runner-proxy-jobs-001): create (atrium-job-* name, validated body),
// start, wait, logs, remove. Nothing here execs, pulls, or mounts writable
// paths, so the same code runs:
//   - on the HOST (agent context): direct engine API — named pipe on Windows,
//     /var/run/docker.sock elsewhere
//   - inside the Atrium container: via DOCKER_HOST=http://docker-socket-proxy:2375,
//     where the proxy enforces the image allowlist + ro-workspace policy
//
// Results come back over LOGS, not mounts: the proxy allows only read-only
// binds, and `swift build` needs a writable tree — so the job copies /src to
// a container-internal /work, runs there, and prints the report between
// sentinel markers for extraction. No writable mount, no docker-cp (the
// archive endpoint is not in the proxy's allowlist).

const http = require('http');
const os = require('os');

const JOB_PREFIX = 'atrium-job-';
const REPORT_BEGIN = '===ATRIUM-REPORT-BEGIN===';
const REPORT_END = '===ATRIUM-REPORT-END===';
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

// --- engine endpoint resolution ------------------------------------------

// DOCKER_HOST=http://host:port wins (the in-container proxy case, or a remote
// engine). Otherwise the platform-default local socket.
function engineTarget(env = process.env) {
  const dh = env.DOCKER_HOST || '';
  const m = dh.match(/^(?:http|tcp):\/\/([^:/]+)(?::(\d+))?/);
  if (m) return { host: m[1], port: Number(m[2] || 2375) };
  if ((env.ATRIUM_PLATFORM || os.platform()) === 'win32') {
    return { socketPath: '\\\\.\\pipe\\docker_engine' };
  }
  return { socketPath: '/var/run/docker.sock' };
}

// Minimal engine-API request. Body in, JSON (or raw buffer) out. Injectable
// request implementation so the orchestration is testable without a daemon.
function dockerRequest({ method, path, body = null, raw = false, timeoutMs = 30_000 }, deps = {}) {
  const target = deps.target || engineTarget();
  const requestImpl = deps.request || http.request;
  return new Promise((resolve, reject) => {
    const payload = body != null ? Buffer.from(JSON.stringify(body)) : null;
    const req = requestImpl({
      ...target,
      method,
      path,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
        : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 400) {
          let message = buf.toString('utf8').slice(0, 500);
          try { message = JSON.parse(message).message || message; } catch { /* not json */ }
          return reject(new Error(`Docker ${method} ${path} → ${res.statusCode}: ${message}`));
        }
        if (raw) return resolve(buf);
        if (buf.length === 0) return resolve(null);
        try { resolve(JSON.parse(buf.toString('utf8'))); } catch { resolve(buf.toString('utf8')); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Docker ${method} ${path} timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// --- pure helpers ---------------------------------------------------------

// Docker's non-TTY log stream is MULTIPLEXED: 8-byte frame headers
// [stream(1), 0,0,0, length(4 BE)] before each payload. Demux to plain text
// (stdout + stderr interleaved in arrival order). Tolerates a plain
// (non-multiplexed) stream by detecting an implausible first header.
function demuxDockerLogs(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf || '');
  if (buf.length === 0) return '';
  const first = buf[0];
  // Frame headers start with stream type 0/1/2 and three zero bytes. Real
  // text virtually never does — printable ASCII starts at 0x20.
  const looksMultiplexed = (first === 0 || first === 1 || first === 2)
    && buf.length >= 8 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0;
  if (!looksMultiplexed) return buf.toString('utf8');

  const parts = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off + 4);
    const start = off + 8;
    const end = Math.min(start + len, buf.length);
    parts.push(buf.slice(start, end).toString('utf8'));
    off = start + len;
  }
  return parts.join('');
}

// The in-container script: copy the read-only /src to a writable /work, run
// the suite command there, then print the report file between sentinels so
// it travels back over the logs endpoint. The command's own exit code is
// preserved as the job's exit code.
function buildJobScript(command, reportPath) {
  const report = String(reportPath || '').replace(/'/g, '');
  return [
    'set -o pipefail',
    // Copy CONTENTS (`/src/.`) — WorkingDir makes Docker pre-create /work, so
    // `cp -r /src /work` would nest the tree at /work/src instead.
    'cp -a /src/. /work/ && cd /work',
    `(${command})`,
    'status=$?',
    ...(report ? [
      `if [ -f '${report}' ]; then`,
      `  echo '${REPORT_BEGIN}'`,
      `  cat '${report}'`,
      `  echo '${REPORT_END}'`,
      'fi',
    ] : []),
    'exit $status',
  ].join('\n');
}

// Pull the marked report back out of the demuxed logs.
// Returns { report, output } — output has the report block removed so the
// human-readable log doesn't duplicate a wall of XML.
function extractMarkedReport(logs) {
  const text = String(logs || '');
  const begin = text.indexOf(REPORT_BEGIN);
  const end = text.indexOf(REPORT_END);
  if (begin === -1 || end === -1 || end < begin) {
    return { report: null, output: text };
  }
  const report = text.slice(begin + REPORT_BEGIN.length, end).trim();
  const output = (text.slice(0, begin) + text.slice(end + REPORT_END.length)).trim();
  return { report, output };
}

function jobName(taskId) {
  const safe = String(taskId || 'run').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^[-.]+/, '').slice(0, 40) || 'run';
  return `${JOB_PREFIX}${safe}-${Math.abs(Date.now() % 1_000_000_000)}`;
}

// --- orchestration --------------------------------------------------------

// Run one container job: create → start → wait (with timeout) → logs →
// remove. Returns { exitCode, output, report } where `report` is the marked
// report file's contents (or null when the command never wrote one).
async function runContainerJob({ image, command, cwd, reportPath, taskId, timeoutMs = DEFAULT_TIMEOUT_MS }, deps = {}) {
  const request = deps.dockerRequest || dockerRequest;
  const log = deps.log || (() => {});
  const name = deps.jobName || jobName(taskId);

  // Host paths in binds: engine API on Docker Desktop accepts C:/-style
  // paths; normalize backslashes so the same config works everywhere.
  const hostSrc = String(cwd).replace(/\\/g, '/');

  const createBody = {
    Image: image,
    // bash -lc so PATH and locale behave like an interactive toolchain image.
    Cmd: ['bash', '-lc', buildJobScript(command, reportPath)],
    WorkingDir: '/work',
    HostConfig: {
      // Read-only source bind — the ONLY mount shape the proxy permits.
      Binds: [`${hostSrc}:/src:ro`],
      // bridge (not host): SPM dependency resolution needs the network.
      NetworkMode: 'bridge',
    },
    Labels: { 'atrium.job': 'test-runner', 'atrium.task': String(taskId || '') },
  };

  log(`[container-job] create name=${name} image=${image}`);
  await request({ method: 'POST', path: `/containers/create?name=${encodeURIComponent(name)}`, body: createBody });

  // From here on the container EXISTS — every path below must reach the
  // remove call, and a start/wait failure (including timeout) becomes a
  // failing RESULT with logs attached rather than an opaque throw.
  let exitCode = -1;
  let runError = null;
  try {
    await request({ method: 'POST', path: `/containers/${name}/start` });
    log(`[container-job] started — waiting (timeout ${Math.round(timeoutMs / 1000)}s)`);
    const waited = await request({ method: 'POST', path: `/containers/${name}/wait`, timeoutMs });
    exitCode = waited && typeof waited.StatusCode === 'number' ? waited.StatusCode : -1;
  } catch (err) {
    runError = err;
  }

  // Logs before remove; remove ALWAYS (a timed-out wait must not leak a
  // running container — force kills it).
  let logsBuf = Buffer.alloc(0);
  try {
    logsBuf = await request({ method: 'GET', path: `/containers/${name}/logs?stdout=1&stderr=1`, raw: true });
  } catch (err) {
    log(`[container-job] logs fetch failed: ${err.message}`);
  }
  try {
    await request({ method: 'DELETE', path: `/containers/${name}?force=1&v=1` });
  } catch (err) {
    log(`[container-job] remove failed: ${err.message}`);
  }

  const text = demuxDockerLogs(logsBuf);
  const { report, output } = extractMarkedReport(text);
  const finalOutput = runError ? `${output}\n[container-job] ${runError.message}`.trim() : output;
  return { exitCode, output: finalOutput, report, jobName: name };
}

module.exports = {
  JOB_PREFIX,
  REPORT_BEGIN,
  REPORT_END,
  engineTarget,
  dockerRequest,
  demuxDockerLogs,
  buildJobScript,
  extractMarkedReport,
  jobName,
  runContainerJob,
};
