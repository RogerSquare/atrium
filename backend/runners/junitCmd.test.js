// Unit tests for the JUnit XML parser + exit-code summary (feat-runners-core-001).
// JUnit XML is the lingua franca for every non-Playwright runner (swift test
// --xunit-output, gradle, dotnet, pytest), so the parser earns a thorough matrix.

const test = require('node:test');
const assert = require('node:assert');
const { parseJunitXml, exitCodeSummary, decodeEntities } = require('./junitCmd');

// --- happy paths ----------------------------------------------------------

test('single <testsuite> root with mixed results', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="MyTests" tests="3" failures="1" time="1.5">
  <testcase classname="MyTests.Login" name="testValid" time="0.5"/>
  <testcase classname="MyTests.Login" name="testInvalid" time="0.25">
    <failure message="XCTAssertEqual failed">expected 200 got 401</failure>
  </testcase>
  <testcase classname="MyTests.Login" name="testPending" time="0">
    <skipped/>
  </testcase>
</testsuite>`;
  const r = parseJunitXml(xml);
  assert.strictEqual(r.total, 3);
  assert.strictEqual(r.passed, 1);
  assert.strictEqual(r.failed, 1);
  assert.strictEqual(r.skipped, 1);
  assert.strictEqual(r.duration_ms, 750);
  assert.strictEqual(r.specs[0].file, 'MyTests.Login');
  assert.strictEqual(r.specs[0].title, 'testValid');
  assert.strictEqual(r.specs[0].status, 'passed');
  assert.strictEqual(r.specs[0].duration_ms, 500);
  assert.deepStrictEqual(r.specs[0].attachments, []);
  assert.strictEqual(r.specs[1].status, 'failed');
  assert.match(r.specs[1].error, /XCTAssertEqual failed/);
  assert.match(r.specs[1].error, /expected 200 got 401/);
  assert.strictEqual(r.specs[2].status, 'skipped');
  assert.strictEqual(r.specs[2].error, null);
});

test('<testsuites> root wrapping several suites (gradle/swift shape)', () => {
  const xml = `<testsuites tests="2">
  <testsuite name="A"><testcase classname="A" name="one" time="0.1"/></testsuite>
  <testsuite name="B"><testcase classname="B" name="two" time="0.2"><error message="boom"/></testcase></testsuite>
</testsuites>`;
  const r = parseJunitXml(xml);
  assert.strictEqual(r.total, 2);
  assert.strictEqual(r.passed, 1);
  // <error> counts as failed — a crash is not a pass.
  assert.strictEqual(r.failed, 1);
  assert.match(r.specs[1].error, /boom/);
});

test('CDATA failure bodies survive intact', () => {
  const xml = `<testsuite><testcase name="t"><failure><![CDATA[assert x < 10 && y > 2]]></failure></testcase></testsuite>`;
  const r = parseJunitXml(xml);
  assert.strictEqual(r.specs[0].status, 'failed');
  assert.match(r.specs[0].error, /x < 10 && y > 2/);
});

test('XML entities decode in attributes and bodies', () => {
  const xml = `<testsuite><testcase name="a &lt; b &amp; c" time="0.001"><failure message="1 &gt; 2">x &quot;q&quot;</failure></testcase></testsuite>`;
  const r = parseJunitXml(xml);
  assert.strictEqual(r.specs[0].title, 'a < b & c');
  assert.match(r.specs[0].error, /1 > 2/);
  assert.match(r.specs[0].error, /x "q"/);
});

test('single-quoted attributes parse (pytest emits these)', () => {
  const xml = `<testsuite><testcase classname='pkg.mod' name='test_it' time='0.03'/></testsuite>`;
  const r = parseJunitXml(xml);
  assert.strictEqual(r.specs[0].file, 'pkg.mod');
  assert.strictEqual(r.specs[0].duration_ms, 30);
});

test('missing time/classname attributes default to 0 / empty', () => {
  const xml = `<testsuite><testcase name="bare"/></testsuite>`;
  const r = parseJunitXml(xml);
  assert.strictEqual(r.specs[0].duration_ms, 0);
  assert.strictEqual(r.specs[0].file, '');
  assert.strictEqual(r.duration_ms, 0);
});

test('comments are ignored', () => {
  const xml = `<testsuite><!-- <testcase name="ghost"/> --><testcase name="real"/></testsuite>`;
  const r = parseJunitXml(xml);
  assert.strictEqual(r.total, 1);
  assert.strictEqual(r.specs[0].title, 'real');
});

// --- error paths ----------------------------------------------------------

test('empty / non-JUnit / caseless inputs throw', () => {
  assert.throws(() => parseJunitXml(''), /empty/);
  assert.throws(() => parseJunitXml('<html></html>'), /no <testsuite>/);
  assert.throws(() => parseJunitXml('<testsuite name="empty"></testsuite>'), /no <testcase>/);
});

// --- exitCodeSummary ------------------------------------------------------

test('exit 0 → one passing spec named after the command', () => {
  const s = exitCodeSummary({ command: 'make check', exitCode: 0, durationMs: 1200, output: 'ok' });
  assert.strictEqual(s.total, 1);
  assert.strictEqual(s.passed, 1);
  assert.strictEqual(s.failed, 0);
  assert.strictEqual(s.specs[0].title, 'make check');
  assert.strictEqual(s.specs[0].status, 'passed');
  assert.strictEqual(s.specs[0].error, null);
});

test('non-zero exit → one failing spec carrying the tail of the output', () => {
  const s = exitCodeSummary({ command: 'make check', exitCode: 2, durationMs: 300, output: 'boom happened' });
  assert.strictEqual(s.failed, 1);
  assert.match(s.specs[0].error, /exit code 2/);
  assert.match(s.specs[0].error, /boom happened/);
});

// --- decodeEntities -------------------------------------------------------

test('numeric and hex entities decode; &amp; does not double-decode', () => {
  assert.strictEqual(decodeEntities('&#65;&#x42;'), 'AB');
  assert.strictEqual(decodeEntities('&amp;lt;'), '&lt;');
});
