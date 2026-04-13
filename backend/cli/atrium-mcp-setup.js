#!/usr/bin/env node
// Atrium MCP setup — installs the Atrium skill and registers the stdio MCP server
// with Claude Code. Intended to be run once per user machine after a Claude CLI install.
//
// Usage:
//   atrium-mcp-setup --token <agent-token> [--url http://localhost:3001] [--name atrium]
//
// What it does:
//   1. Validates the token against the Atrium backend (/api/auth/verify).
//   2. Copies backend/mcp/skill/SKILL.md → ~/.claude/skills/atrium/SKILL.md
//   3. Calls `claude mcp add ...` to register the stdio server at user scope.
//   4. Prints next-step instructions.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--token') out.token = argv[++i];
    else if (a === '--url') out.url = argv[++i];
    else if (a === '--name') out.name = argv[++i];
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function usage() {
  console.log(`atrium-mcp-setup — register the Atrium MCP server with Claude Code.

Usage:
  atrium-mcp-setup --token <agent-token> [--url <url>] [--name <server-name>]

Flags:
  --token  (required)  Agent token minted via Atrium admin UI or POST /api/auth/agent-token.
  --url                Atrium backend URL. Default: http://localhost:3001
  --name               MCP server name in Claude's config. Default: atrium
  -h, --help           Show this help.`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.token) { usage(); process.exit(args.help ? 0 : 1); }

  const url = args.url || 'http://localhost:3001';
  const name = args.name || 'atrium';
  const token = args.token;

  // 1. Validate token
  process.stdout.write(`[1/3] Verifying token against ${url}... `);
  let verifyRes;
  try {
    verifyRes = await fetch(`${url}/api/verify`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
  } catch (err) {
    console.log('FAILED');
    console.error(`  Cannot reach ${url}. Is atrium-backend running?`);
    process.exit(1);
  }
  if (!verifyRes.ok) {
    console.log('FAILED');
    const body = await verifyRes.text().catch(() => '');
    console.error(`  ${verifyRes.status}: ${body}`);
    process.exit(1);
  }
  const verified = await verifyRes.json().catch(() => ({}));
  console.log(`OK (${verified.username || 'unknown'})`);

  // 2. Install skill
  const skillSrc = path.resolve(__dirname, '..', 'mcp', 'skill', 'SKILL.md');
  const skillDir = path.join(os.homedir(), '.claude', 'skills', name);
  const skillDest = path.join(skillDir, 'SKILL.md');
  process.stdout.write(`[2/3] Installing skill → ${skillDest}... `);
  if (!fs.existsSync(skillSrc)) {
    console.log('FAILED');
    console.error(`  Source skill not found at ${skillSrc}. Is this a full atrium-backend checkout?`);
    process.exit(1);
  }
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(skillSrc, skillDest);
  console.log('OK');

  // 3. Register MCP server with Claude Code
  const serverPath = path.resolve(__dirname, '..', 'mcp', 'server.js');
  process.stdout.write(`[3/3] Registering MCP server with Claude Code... `);

  // Remove existing registration with the same name so this is idempotent.
  spawnSync('claude', ['mcp', 'remove', name], { stdio: 'ignore', shell: true });

  // Order chosen to match `claude mcp add --help`: name first, then command, then options including -e.
  // On Windows, shell:true is needed because `claude` is typically a .cmd wrapper.
  const addArgs = [
    'mcp', 'add',
    name,
    '--transport', 'stdio',
    '--scope', 'user',
    '-e', `ATRIUM_API_TOKEN=${token}`,
    '-e', `ATRIUM_URL=${url}`,
    '--',
    'node', `"${serverPath}"`,
  ];
  console.log(''); // newline before command preview
  console.log(`  running: claude ${addArgs.join(' ').replace(token, '<REDACTED>')}`);
  const result = spawnSync('claude', addArgs, { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  if (result.status !== 0) {
    const stderr = (result.stderr || Buffer.alloc(0)).toString();
    const stdout = (result.stdout || Buffer.alloc(0)).toString();
    console.error(`  FAILED`);
    if (stderr) console.error(`  stderr: ${stderr.trim()}`);
    if (stdout) console.error(`  stdout: ${stdout.trim()}`);
    console.error(`  Check \`claude mcp add --help\` for the correct syntax on your version.`);
    process.exit(1);
  }
  console.log('  OK');

  console.log('');
  console.log('Setup complete. Open a new claude session and try:');
  console.log(`  claude`);
  console.log(`  > "list atrium tasks"`);
  console.log('');
  console.log('To revoke this token later, use the admin UI or:');
  console.log(`  curl -X DELETE ${url}/api/agent-tokens/<jti> -H "Authorization: Bearer <admin-token>"`);
}

main().catch(err => {
  console.error(`[atrium-mcp-setup] Fatal: ${err.message}`);
  process.exit(1);
});
