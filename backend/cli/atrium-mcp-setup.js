#!/usr/bin/env node
// Atrium MCP setup — installs the Atrium skill and registers the stdio MCP server
// with Claude Code. Intended to be run once per user machine after a Claude CLI install.
//
// Usage:
//   atrium-mcp-setup --token <agent-token> [--url http://localhost:3001] [--name atrium] [--dry-run] [--force]
//
// What it does:
//   1. Validates the token against the Atrium backend (GET /api/verify).
//   2. Probes GET /api/instance so the MCP entry records the URL the instance
//      actually reports, not an assumed localhost:3001 (feat-mcp-bootstrap-001).
//   3. Copies the canonical .claude/skills/atrium/SKILL.md → ~/.claude/skills/atrium/SKILL.md.
//   4. Registers the stdio server at user scope — idempotently: an existing
//      entry under the same name is left alone unless --force.
//   5. Runs a health check (skill / MCP entry / reachability / token) and prints
//      pass-fail per line.
//
// --dry-run prints what it WOULD do and writes nothing.

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
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

function usage() {
  console.log(`atrium-mcp-setup — register the Atrium MCP server with Claude Code.

Usage:
  atrium-mcp-setup --token <agent-token> [--url <url>] [--name <server-name>] [--dry-run] [--force]

Flags:
  --token  (required)  Agent token minted via the Atrium admin UI or POST /api/agent-token.
  --url                Atrium backend URL. Default: http://localhost:3001
  --name               MCP server name in Claude's config. Default: atrium
  --dry-run            Print the intended actions without writing anything.
  --force              Overwrite an existing MCP entry of the same name (default: skip it).
  -h, --help           Show this help.`);
}

// `claude mcp get <name>` exits 0 when an entry exists. Used to avoid trampling
// a config the user already has.
function mcpEntryExists(name) {
  return spawnSync('claude', ['mcp', 'get', name], { stdio: 'ignore', shell: true }).status === 0;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.token) { usage(); process.exit(args.help ? 0 : 1); }

  const url = (args.url || 'http://localhost:3001').replace(/\/$/, '');
  const name = args.name || 'atrium';
  const token = args.token;
  const dry = !!args.dryRun;
  if (dry) console.log('(dry-run — no changes will be written)\n');

  // 1. Validate token
  process.stdout.write(`[1/4] Verifying token against ${url}... `);
  let verifyRes;
  try {
    verifyRes = await fetch(`${url}/api/verify`, { headers: { Authorization: `Bearer ${token}` } });
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

  // 2. Probe the instance so the MCP entry records the URL that actually works.
  //    Older backends without /api/instance simply fall back to --url.
  let mcpUrl = url;
  process.stdout.write('[2/4] Probing instance... ');
  try {
    const r = await fetch(`${url}/api/instance`);
    if (r.ok) {
      const info = await r.json().catch(() => ({}));
      if (info.url) mcpUrl = String(info.url).replace(/\/$/, '');
      console.log(`OK (${info.name || 'Atrium'}${info.version ? ' v' + info.version : ''} @ ${mcpUrl})`);
    } else {
      console.log(`skipped (HTTP ${r.status}) — using ${mcpUrl}`);
    }
  } catch {
    console.log(`skipped (no /api/instance) — using ${mcpUrl}`);
  }

  // 3. Install skill (canonical source shared with the image + sync:skills).
  const skillSrc = path.resolve(__dirname, '..', '..', '.claude', 'skills', 'atrium', 'SKILL.md');
  const skillDir = path.join(os.homedir(), '.claude', 'skills', name);
  const skillDest = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillSrc)) {
    console.error(`[3/4] FAILED — source skill not found at ${skillSrc}. Is this a full atrium checkout?`);
    process.exit(1);
  }
  if (dry) {
    console.log(`[3/4] (dry-run) would install skill → ${skillDest}`);
  } else {
    process.stdout.write(`[3/4] Installing skill → ${skillDest}... `);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.copyFileSync(skillSrc, skillDest); // identical bytes on a re-run → no diff
    console.log('OK');
  }

  // 4. Register the MCP server — idempotent, no-trample.
  const serverPath = path.resolve(__dirname, '..', 'mcp', 'server.js');
  const addArgs = [
    'mcp', 'add', name,
    '--transport', 'stdio',
    '--scope', 'user',
    '-e', `ATRIUM_API_TOKEN=${token}`,
    '-e', `ATRIUM_URL=${mcpUrl}`,
    '--',
    'node', `"${serverPath}"`,
  ];
  const preview = `claude ${addArgs.join(' ').replace(token, '<REDACTED>')}`;
  const exists = mcpEntryExists(name);

  if (exists && !args.force) {
    console.log(`[4/4] MCP server "${name}" already configured — skipping (re-run with --force to overwrite).`);
  } else if (dry) {
    console.log(`[4/4] (dry-run) would ${exists ? 'replace' : 'register'} MCP server:`);
    console.log(`        ${preview}`);
  } else {
    process.stdout.write(`[4/4] ${exists ? 'Replacing' : 'Registering'} MCP server "${name}"... `);
    if (exists) spawnSync('claude', ['mcp', 'remove', name], { stdio: 'ignore', shell: true });
    const result = spawnSync('claude', addArgs, { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
    if (result.status !== 0) {
      console.log('FAILED');
      const stderr = (result.stderr || Buffer.alloc(0)).toString().trim();
      const stdout = (result.stdout || Buffer.alloc(0)).toString().trim();
      if (stderr) console.error(`  stderr: ${stderr}`);
      if (stdout) console.error(`  stdout: ${stdout}`);
      console.error(`  running: ${preview}`);
      console.error(`  Check \`claude mcp add --help\` for the correct syntax on your version.`);
      process.exit(1);
    }
    console.log('OK');
  }

  // Health check — every step verified, one line each. Skipped for dry-run,
  // which by design changed nothing.
  if (!dry) {
    console.log('\nHealth check:');
    const check = (ok, label, detail) => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
    check(fs.existsSync(skillDest), 'skill installed', skillDest);
    check(mcpEntryExists(name), 'MCP entry present', name);
    let reachable = false;
    try { reachable = (await fetch(`${url}/api/health`)).ok; } catch { /* unreachable */ }
    check(reachable, 'Atrium reachable', url);
    check(true, 'token verified', verified.username || 'ok');
  }

  console.log('');
  console.log(dry ? 'Dry run complete — nothing was written.' : 'Setup complete. Open a new claude session and try:');
  if (!dry) {
    console.log('  claude');
    console.log('  > "list atrium tasks"');
    console.log('');
    console.log('To revoke this token later, use the admin UI or:');
    console.log(`  curl -X DELETE ${mcpUrl}/api/agent-tokens/<jti> -H "Authorization: Bearer <admin-token>"`);
  }
}

main().catch((err) => {
  console.error(`[atrium-mcp-setup] Fatal: ${err.message}`);
  process.exit(1);
});
