// getCachedTaskCount backs /api/health/ready (bug-health-ready-timeout-001).
// It must never scan: on a bind-mounted tasks dir a scan takes seconds and
// the container HEALTHCHECK times out. Runs in a child process with its own
// ATRIUM_DATA_DIR so the module-level cache starts cold and no real tasks
// are touched.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const script = `
const fs = require('fs');
const path = require('path');
const { TASKS_DIR } = require(${JSON.stringify(path.join(__dirname, 'constants'))});
fs.mkdirSync(path.join(TASKS_DIR, 'Proj'), { recursive: true });
for (const id of ['t-1', 't-2', 't-3']) {
  fs.writeFileSync(path.join(TASKS_DIR, 'Proj', id + '.md'), '---\\nid: ' + id + '\\ntitle: x\\n---\\nbody\\n');
}
const tasks = require(${JSON.stringify(path.join(__dirname, 'tasks'))});
const cold = tasks.getCachedTaskCount();
const all = tasks.getAllTasks().length;
const warm = tasks.getCachedTaskCount();
tasks.invalidateCache();
const afterInvalidate = tasks.getCachedTaskCount();
process.stdout.write(JSON.stringify({ cold, all, warm, afterInvalidate }));
`;

test('getCachedTaskCount reports the last scan without scanning', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-cachedcount-'));
  try {
    const out = execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, ATRIUM_DATA_DIR: dataDir, LOG_LEVEL: 'silent' },
      encoding: 'utf8',
    });
    const r = JSON.parse(out.slice(out.lastIndexOf('{"cold"')));
    assert.strictEqual(r.cold, null, 'cold cache must report null, not trigger a scan');
    assert.strictEqual(r.all, 3);
    assert.strictEqual(r.warm, 3);
    // The scan also built the id index, so a dropped cache still has a count.
    assert.strictEqual(r.afterInvalidate, 3);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
