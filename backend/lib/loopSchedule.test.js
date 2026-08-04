// Unit tests for lib/loopSchedule.js (feat-hub-rethink-impl-001).
// All `now` values are fixed local-time dates so results are deterministic.

const test = require('node:test');
const assert = require('node:assert');

const { nextOccurrence, delayUntilNext, scheduleError, normalizeSchedule, SCHEDULE_DAYS } = require('./loopSchedule');

// 2026-08-03 is a Monday.
const monday = (h, m = 0) => new Date(2026, 7, 3, h, m, 0, 0);

test('later today: fires the same day when the time is still ahead', () => {
  const next = nextOccurrence({ time: '09:00' }, monday(8));
  assert.strictEqual(next.getDay(), 1);
  assert.strictEqual(next.getHours(), 9);
  assert.strictEqual(next.getDate(), 3);
});

test('earlier today wraps to tomorrow', () => {
  const next = nextOccurrence({ time: '09:00' }, monday(10));
  assert.strictEqual(next.getDate(), 4); // Tuesday
  assert.strictEqual(next.getHours(), 9);
});

test('exactly-now is not a match — strictly in the future', () => {
  const next = nextOccurrence({ time: '09:00' }, monday(9));
  assert.strictEqual(next.getDate(), 4);
});

test('day picker skips disallowed days across a weekend', () => {
  const friday = new Date(2026, 7, 7, 10, 0, 0, 0); // Fri, past 09:00
  const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri'];
  const next = nextOccurrence({ time: '09:00', days: weekdays }, friday);
  assert.strictEqual(next.getDay(), 1); // Monday
  assert.strictEqual(next.getDate(), 10);
});

test('midnight edge: 00:00 just passed → next allowed day at 00:00', () => {
  const next = nextOccurrence({ time: '00:00' }, new Date(2026, 7, 3, 0, 0, 30));
  assert.strictEqual(next.getDate(), 4);
  assert.strictEqual(next.getHours(), 0);
  assert.strictEqual(next.getMinutes(), 0);
});

test('delayUntilNext returns positive ms and matches nextOccurrence', () => {
  const now = monday(8, 30);
  const delay = delayUntilNext({ time: '09:00' }, now);
  assert.strictEqual(delay, 30 * 60 * 1000);
});

test('wall-clock hour is honored across a DST-shifted week', () => {
  // Whatever the local zone does in this stretch, the fire hour stays 09.
  for (let d = 0; d < 400; d += 37) {
    const now = new Date(2026, 2, 1 + (d % 60), 12, 0, 0, 0);
    const next = nextOccurrence({ time: '09:00' }, now);
    assert.strictEqual(next.getHours(), 9);
  }
});

test('invalid shapes are rejected: bad time, empty days, unknown day', () => {
  assert.ok(scheduleError({ time: '9:00' }));
  assert.ok(scheduleError({ time: '24:00' }));
  assert.ok(scheduleError({ time: '09:00', days: [] }));
  assert.ok(scheduleError({ time: '09:00', days: ['monday'] }));
  assert.strictEqual(scheduleError(null), null);
  assert.strictEqual(scheduleError({ time: '09:00' }), null);
  assert.strictEqual(nextOccurrence({ time: 'bogus' }, monday(8)), null);
  assert.strictEqual(delayUntilNext(null, monday(8)), null);
});

test('normalizeSchedule fills days explicitly and dedupes', () => {
  assert.deepStrictEqual(normalizeSchedule({ time: '07:30' }).days, SCHEDULE_DAYS);
  assert.deepStrictEqual(normalizeSchedule({ time: '07:30', days: ['mon', 'mon', 'fri'] }).days, ['mon', 'fri']);
  assert.strictEqual(normalizeSchedule({ time: 'nope' }), null);
});
