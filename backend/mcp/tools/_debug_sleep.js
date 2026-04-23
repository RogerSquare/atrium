// TEMPORARY probe — do NOT merge to main.
// Used to empirically measure Claude Code's MCP tool-call timeout.
// See backend/docs/mcp-long-poll-empirical.md for the test protocol + findings.
module.exports = {
  name: 'atrium_debug_sleep',
  description: 'TEMPORARY probe. Blocks for `seconds` then returns. For Claude Code MCP tool-call timeout testing only. Remove before merging to main.',
  inputSchema: {
    type: 'object',
    properties: {
      seconds: { type: 'number', description: 'Seconds to block. Cap in the test is whatever Claude Code will tolerate.' },
    },
    required: ['seconds'],
  },
  handler: async ({ seconds }) => {
    const start = Date.now();
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    return { slept_ms: Date.now() - start, requested_seconds: seconds };
  },
};
