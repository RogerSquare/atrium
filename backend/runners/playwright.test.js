// Unit tests for the extracted Playwright summarizer (feat-runners-core-001).
// summarize() moved out of scripts/run-e2e.js — these pin its behavior so the
// refactor is provably identical for the default suite.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { summarize } = require('./playwright');

const BASE = path.resolve('/repo/frontend');

const REPORT = {
  stats: { startTime: '2026-01-01T00:00:00.000Z', duration: 5000, expected: 2, unexpected: 1, skipped: 1, flaky: 0 },
  suites: [
    {
      file: 'a.spec.js',
      specs: [
        {
          title: 'passes',
          file: 'a.spec.js',
          tests: [{ results: [
            { status: 'failed', duration: 10, errors: [{ message: 'first try' }] },
            { status: 'passed', duration: 90, attachments: [
              { name: 'video', contentType: 'video/webm', path: path.join(BASE, 'test-results', 'v.webm') },
              { name: 'trace', contentType: 'application/zip' },
            ] },
          ] }],
        },
      ],
      suites: [
        {
          // nested suite without its own file — inherits the ancestor's
          specs: [
            { title: 'fails', tests: [{ results: [{ status: 'failed', duration: 40, errors: [{ message: 'boom' }] }] }] },
          ],
        },
      ],
    },
    {
      file: 'b.spec.js',
      specs: [
        { title: 'skipped one', tests: [{ results: [{ status: 'skipped', duration: 0 }] }] },
        { title: 'no results yet', tests: [{ results: [] }] },
      ],
    },
  ],
};

test('summarize walks nested suites and takes the LAST result of each test', () => {
  const s = summarize(REPORT, BASE);
  assert.strictEqual(s.total, 4);
  const first = s.specs.find((x) => x.title === 'passes');
  assert.strictEqual(first.status, 'passed');
  assert.strictEqual(first.duration_ms, 90);
  assert.strictEqual(first.error, null);
});

test('stats win over recomputed counts (Playwright already aggregated)', () => {
  const s = summarize(REPORT, BASE);
  assert.strictEqual(s.passed, 2);
  assert.strictEqual(s.failed, 1);
  assert.strictEqual(s.skipped, 1);
  assert.strictEqual(s.flaky, 0);
  assert.strictEqual(s.duration_ms, 5000);
  assert.strictEqual(s.started_at, '2026-01-01T00:00:00.000Z');
});

test('attachment paths are relativized against baseDir with forward slashes', () => {
  const s = summarize(REPORT, BASE);
  const att = s.specs.find((x) => x.title === 'passes').attachments;
  assert.strictEqual(att[0].path, 'test-results/v.webm');
  assert.strictEqual(att[1].path, null);
});

test('nested suite specs inherit the ancestor file', () => {
  const s = summarize(REPORT, BASE);
  const nested = s.specs.find((x) => x.title === 'fails');
  assert.strictEqual(nested.file, 'a.spec.js');
  assert.match(nested.error, /boom/);
});

test('a test with no results reports status unknown', () => {
  const s = summarize(REPORT, BASE);
  const pending = s.specs.find((x) => x.title === 'no results yet');
  assert.strictEqual(pending.status, 'unknown');
  assert.strictEqual(pending.duration_ms, 0);
});

test('empty report → zeroed summary (stats absent falls back to recount)', () => {
  const s = summarize({}, BASE);
  assert.strictEqual(s.total, 0);
  assert.strictEqual(s.passed, 0);
  assert.strictEqual(s.failed, 0);
});
