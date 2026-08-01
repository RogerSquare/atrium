// Included ONLY by the node-unit-fail-demo suite — proves the red path.
// A separate file rather than an env-var switch because local commands run
// through cmd.exe on Windows, where POSIX `VAR=1 cmd` prefixes don't apply.
import { test } from 'node:test'
import assert from 'node:assert'

test('fails on purpose', () => { assert.fail('intentional failure — red-path demo') })
