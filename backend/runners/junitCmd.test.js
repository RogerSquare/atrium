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

// --- real-world report shapes (feat-runner-junit-001) ---------------------
// Each fixture mirrors what the actual tool emits, quirks included.

test('gradle shape: nested testsuites, properties block, system-out noise', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.example.CalcTest" tests="3" skipped="1" failures="1" errors="0" timestamp="2026-08-01T00:00:00" hostname="ci" time="0.042">
  <properties>
    <property name="java.version" value="17.0.2"/>
  </properties>
  <testcase name="adds" classname="com.example.CalcTest" time="0.011"/>
  <testcase name="dividesByZero" classname="com.example.CalcTest" time="0.02">
    <failure message="expected: &lt;5&gt; but was: &lt;4&gt;" type="org.opentest4j.AssertionFailedError">org.opentest4j.AssertionFailedError: expected: &lt;5&gt; but was: &lt;4&gt;
\tat com.example.CalcTest.dividesByZero(CalcTest.java:21)</failure>
  </testcase>
  <testcase name="slowPath" classname="com.example.CalcTest" time="0.0">
    <skipped/>
  </testcase>
  <system-out><![CDATA[stdout noise
lines]]></system-out>
  <system-err><![CDATA[]]></system-err>
</testsuite>`;
  const r = parseJunitXml(xml);
  assert.strictEqual(r.total, 3);
  assert.strictEqual(r.passed, 1);
  assert.strictEqual(r.failed, 1);
  assert.strictEqual(r.skipped, 1);
  assert.match(r.specs[1].error, /expected: <5> but was: <4>/);
  assert.match(r.specs[1].error, /CalcTest\.java:21/);
});

test('pytest shape: file attribute, skipped with message, error element', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" errors="1" failures="1" skipped="1" tests="4" time="0.12" timestamp="2026-08-01T00:00:00" hostname="box">
    <testcase classname="test_math" name="test_adds" time="0.001" file="test_math.py" line="3"/>
    <testcase classname="test_math" name="test_fails" time="0.002" file="test_math.py" line="7">
      <failure message="AssertionError: DEMO_FAIL=1 - intentional failure">def test_fails(): ...</failure>
    </testcase>
    <testcase classname="test_math" name="test_skipped" time="0.0" file="test_math.py" line="11">
      <skipped type="pytest.skip" message="requires GPU">skipped here</skipped>
    </testcase>
    <testcase classname="test_math" name="test_broken_fixture" time="0.0">
      <error message="fixture 'db' not found">collection error</error>
    </testcase>
  </testsuite>
</testsuites>`;
  const r = parseJunitXml(xml);
  assert.strictEqual(r.total, 4);
  assert.strictEqual(r.passed, 1);
  // <error> counts as failed; <skipped> with body/attrs still counts skipped.
  assert.strictEqual(r.failed, 2);
  assert.strictEqual(r.skipped, 1);
  assert.match(r.specs[3].error, /fixture 'db' not found/);
});

test('node:test reporter shape: testcases directly under testsuites + XML comments', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
\t<testcase name="adds" time="0.000605" classname="test"/>
\t<testcase name="fails when asked" time="0.000094" classname="test">
\t\t<failure type="testCodeFailure" message="DEMO_FAIL=1 — intentional failure">AssertionError: DEMO_FAIL=1</failure>
\t</testcase>
\t<!-- tests 2 -->
\t<!-- pass 1 -->
\t<!-- fail 1 -->
\t<!-- duration_ms 45 -->
</testsuites>`;
  const r = parseJunitXml(xml);
  assert.strictEqual(r.total, 2);
  assert.strictEqual(r.passed, 1);
  assert.strictEqual(r.failed, 1);
  assert.match(r.specs[1].error, /DEMO_FAIL=1/);
});

test('dotnet junitxml-logger shape: assembly classnames + multiline stack in CDATA', () => {
  const xml = `<testsuites><testsuite name="MyApp.Tests.dll" tests="2" failures="1">
    <testcase classname="MyApp.Tests.CalcTests" name="Adds" time="0.0100000"/>
    <testcase classname="MyApp.Tests.CalcTests" name="Divides" time="0.0200000">
      <failure message="Assert.Equal() Failure"><![CDATA[Expected: 5
Actual:   4
   at MyApp.Tests.CalcTests.Divides() in C:\\src\\CalcTests.cs:line 30]]></failure>
    </testcase>
  </testsuite></testsuites>`;
  const r = parseJunitXml(xml);
  assert.strictEqual(r.total, 2);
  assert.strictEqual(r.failed, 1);
  assert.match(r.specs[1].error, /Assert\.Equal\(\) Failure/);
  assert.match(r.specs[1].error, /line 30/);
  assert.strictEqual(r.specs[1].duration_ms, 20);
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
