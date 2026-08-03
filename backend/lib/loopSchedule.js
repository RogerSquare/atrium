// Time-of-day scheduling for loops (feat-hub-rethink-impl-001).
//
// A schedule is `{ time: 'HH:MM', days: ['mon'..'sun'] }` — deliberately not
// cron syntax: the named use case is "daily at 9am", a picker beats a string
// in the UI, and a `cron` variant can join this object later without
// migration. Times are server-local; the host is the user's own machine.
//
// Pure date math, injectable `now` — unit-tested without timers.

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // Date.getDay() order
const SCHEDULE_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// A single setTimeout never spans more than this; long waits re-check on the
// way (desktop hosts sleep, wake, and change clocks — see loopManager).
const MAX_CHUNK_MS = 6 * 60 * 60 * 1000;

/** Strict shape check used by loops.validate. Returns an error string or null. */
function scheduleError(s) {
  if (s === null) return null;
  if (typeof s !== 'object' || Array.isArray(s)) return 'schedule must be an object or null';
  if (typeof s.time !== 'string' || !TIME_RE.test(s.time)) return 'schedule.time must be "HH:MM" (24h)';
  if (s.days !== undefined) {
    if (!Array.isArray(s.days) || s.days.length === 0 || !s.days.every((d) => SCHEDULE_DAYS.includes(d))) {
      return `schedule.days must be a non-empty subset of ${SCHEDULE_DAYS.join(', ')}`;
    }
  }
  return null;
}

/** Canonical stored form: `{ time, days }` with days always explicit. */
function normalizeSchedule(s) {
  if (!s || scheduleError(s)) return null;
  const days = Array.isArray(s.days) && s.days.length ? [...new Set(s.days)] : [...SCHEDULE_DAYS];
  return { time: s.time, days };
}

/**
 * Next Date (strictly after `now`) matching HH:MM on an allowed day.
 * Local-time setHours keeps DST shifts correct: 09:00 means wall-clock 09:00.
 * Returns null for an invalid schedule.
 */
function nextOccurrence(schedule, now = new Date()) {
  const s = normalizeSchedule(schedule);
  if (!s) return null;
  const [, hh, mm] = TIME_RE.exec(s.time);
  const allowed = new Set(s.days);
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    d.setHours(Number(hh), Number(mm), 0, 0);
    if (d <= now) continue;
    if (allowed.has(DAY_KEYS[d.getDay()])) return d;
  }
  return null; // unreachable with a normalized schedule
}

/** Milliseconds until the next occurrence, or null for an invalid schedule. */
function delayUntilNext(schedule, now = new Date()) {
  const next = nextOccurrence(schedule, now);
  return next ? Math.max(0, next.getTime() - now.getTime()) : null;
}

module.exports = { nextOccurrence, delayUntilNext, scheduleError, normalizeSchedule, SCHEDULE_DAYS, MAX_CHUNK_MS };
