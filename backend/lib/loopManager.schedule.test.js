// Scheduling seam of the loop engine (feat-hub-rethink-impl-001): schedule
// vs interval delay selection and the 6h chunk cap. Pure helpers only — no
// timers are armed here.

const test = require('node:test');
const assert = require('node:assert');

const { nextDelay, nextRunAtISO } = require('./loopManager');
const { MAX_CHUNK_MS } = require('./loopSchedule');

test('interval loops keep their interval delay and always fire', () => {
  const out = nextDelay({ id: 'x', interval_ms: 300000, schedule: null });
  assert.deepStrictEqual(out, { delay: 300000, fire: true });
});

test('near schedules fire at the exact delay', () => {
  // A time within the next 6h of "now": compute one 90 minutes ahead.
  const soon = new Date(Date.now() + 90 * 60 * 1000);
  const time = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;
  const out = nextDelay({ id: 'x', interval_ms: 300000, schedule: { time } });
  assert.strictEqual(out.fire, true);
  assert.ok(out.delay > 0 && out.delay <= MAX_CHUNK_MS);
});

test('far schedules are chunked: capped delay, no fire', () => {
  // A weekly day pick guarantees the next occurrence is >6h away at least
  // once; pick the day AFTER tomorrow to be safe regardless of current time.
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const target = dayKeys[(new Date().getDay() + 2) % 7];
  const out = nextDelay({ id: 'x', interval_ms: 300000, schedule: { time: '12:00', days: [target] } });
  assert.deepStrictEqual(out, { delay: MAX_CHUNK_MS, fire: false });
});

test('an invalid schedule falls back to the interval', () => {
  const out = nextDelay({ id: 'x', interval_ms: 60000, schedule: { time: 'bogus' } });
  assert.deepStrictEqual(out, { delay: 60000, fire: true });
});

test('next_run_at reflects the schedule when present, interval otherwise', () => {
  const scheduled = nextRunAtISO({ interval_ms: 300000, schedule: { time: '09:00' } });
  const d = new Date(scheduled);
  assert.strictEqual(d.getHours(), 9);
  assert.ok(d.getTime() > Date.now());

  const interval = new Date(nextRunAtISO({ interval_ms: 300000, schedule: null })).getTime();
  assert.ok(Math.abs(interval - (Date.now() + 300000)) < 5000);
});
