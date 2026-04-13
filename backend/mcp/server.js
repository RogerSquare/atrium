#!/usr/bin/env node
// Atrium MCP server — stdio transport.
// Spawned by Claude Code when registered via: claude mcp add --transport stdio atrium ...
// Each tool lives in ./tools/<name>.js and exports { name, description, inputSchema, handler }.

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs');
const path = require('path');

// Validate config by triggering the api.js preflight check.
require('./api');

const TOOLS_DIR = path.join(__dirname, 'tools');
const loadTools = () => {
  if (!fs.existsSync(TOOLS_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(TOOLS_DIR)) {
    if (!f.endsWith('.js')) continue;
    try {
      const mod = require(path.join(TOOLS_DIR, f));
      if (Array.isArray(mod)) out.push(...mod);
      else if (mod && mod.name) out.push(mod);
    } catch (err) {
      process.stderr.write(`[atrium-mcp] Failed to load tool ${f}: ${err.message}\n`);
    }
  }
  return out;
};

async function main() {
  const tools = loadTools();
  const toolsByName = new Map(tools.map(t => [t.name, t]));

  const server = new Server(
    { name: 'atrium', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const tool = toolsByName.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    try {
      const result = await tool.handler(args || {});
      return {
        content: [
          { type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error: ${err.message}` }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[atrium-mcp] Server started with ${tools.length} tool(s).\n`);
}

main().catch(err => {
  process.stderr.write(`[atrium-mcp] Fatal: ${err.message}\n`);
  process.exit(1);
});
