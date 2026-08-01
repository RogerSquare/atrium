// Deprecated alias (feat-runners-core-001): atrium_run_e2e now points at the
// generalized runner behind atrium_run_tests. Same handler, same schema —
// kept so existing agent muscle memory and saved prompts keep working.

const runTests = require('./run_tests');

module.exports = {
  name: 'atrium_run_e2e',
  description: `Deprecated alias of atrium_run_tests — same behavior. ${runTests.description}`,
  inputSchema: runTests._impl.inputSchema,
  handler: runTests._impl.runViaScript,
};
