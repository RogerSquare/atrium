// Node's built-in test runner as the LOCAL-target JUnit sample
// (feat-runner-junit-001): zero dependencies, runs on any machine with Node.
import { test } from 'node:test'
import assert from 'node:assert'

test('adds', () => { assert.strictEqual(2 + 3, 5) })
test('multiplies', () => { assert.strictEqual(4 * 5, 20) })
