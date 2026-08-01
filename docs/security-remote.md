# Remote access hardening

How to expose Atrium beyond `localhost` — LAN, tailnet, or a reverse-proxied
hostname — without opening the doors that a local-only install can afford to
leave unlocked. Everything here ships in the backend (devops-harden-remote-001);
this page is the operator's side of the contract.

## TL;DR checklist

- [ ] Terminate TLS in a reverse proxy (Caddy, nginx, Tailscale Serve) — Atrium itself speaks plain HTTP
- [ ] Set `ATRIUM_TRUST_PROXY=true` **only** when a proxy is actually in front
- [ ] Set `ALLOWED_ORIGINS` if any browser reaches the API from a *different* origin (rare — same-origin needs nothing)
- [ ] Set `ATRIUM_ALLOWED_CONTAINERS` so Atrium can only manage its own services
- [ ] Mint agent tokens with `expires_in_days` and rotate on a calendar, not on compromise
- [ ] Passwords are 12+ characters (enforced on register and change-password)

## TLS

Atrium does not terminate TLS. Put a reverse proxy in front and let it own the
certificate:

```
# Tailscale (simplest for a tailnet)
tailscale serve --bg 3100

# Caddy
board.example.com {
    reverse_proxy localhost:3100
}
```

Every hardening measure below assumes the transport is encrypted once traffic
leaves the machine. JWTs ride in headers — over plain HTTP on an untrusted
network they are readable and replayable.

## `ATRIUM_TRUST_PROXY`

The auth rate limiter (5/min) keys on `req.ip`. Behind a reverse proxy with
trust **off**, every visitor shares the proxy's address — one password guesser
rate-limits *everyone's* login. With trust **on** but no proxy in front, any
client can spoof `X-Forwarded-For` and dodge the limiter. So the topology must
be declared, and the default is off:

| Value | Meaning |
| --- | --- |
| unset / `false` / `0` | No proxy. `req.ip` is the socket address. **Default.** |
| `true` | Exactly one proxy hop (maps to `1`, never Express's permissive `true`). |
| `2`, `3`, … | That many hops (CDN → proxy → Atrium, etc.). |
| `loopback`, `10.0.0.0/8`, … | Passed to Express verbatim (named presets, subnets, lists). |

Set it where the backend runs — compose `environment:` block for the
container, shell env for a native launch.

## CORS in production

Same-origin traffic (the SPA the container itself serves, on any published
port) is always allowed — no configuration needed. Beyond that:

- `NODE_ENV=production` + empty `ALLOWED_ORIGINS` = **no cross-origin browser
  access at all**. The old behavior of silently re-opening the dev localhost
  allowlist is gone.
- To serve the frontend from a different origin than the API, list it:
  `ALLOWED_ORIGINS=https://board.example.com`.
- Requests without an `Origin` header (curl, MCP servers, agents) pass
  through but receive **no** `Access-Control-Allow-*` headers — passing is
  not granting. Auth still applies to them as always.

## Password policy

Register and change-password enforce a 12-character minimum. Accounts created
before the policy keep logging in (login is only a hash compare); the rule
bites on their next password change. Length over composition rules is
deliberate — a 12+ passphrase beats `P@ss1` under every modern guidance
(NIST 800-63B).

## Agent tokens: expiry + rotation

`POST /api/auth/agent-token` accepts an optional `expires_in_days` (1–3650):

```bash
curl -X POST http://localhost:3001/api/auth/agent-token \
  -H "Authorization: Bearer <admin-jwt>" -H "Content-Type: application/json" \
  -d '{"name": "claude-desk", "expires_in_days": 90}'
```

The response includes `expires_at`, which also appears in the Settings →
Agent tokens list. Expired tokens 401 like any expired JWT. Omitting the field
mints a non-expiring token (the old behavior) — fine for a desk machine,
wrong for anything that leaves the house.

**Rotation runbook** (works for expiring and non-expiring tokens alike):

1. Mint the replacement first: `POST /api/auth/agent-token` with the same
   `name` and a fresh `expires_in_days`. Two live tokens for one agent is the
   intended overlap state.
2. Update the consumer — MCP config, CI secret, agent env — with the new token.
3. Verify the consumer works (any authed call; the token's `jti` shows up in
   the agent-activity log).
4. Revoke the old token: `DELETE /api/auth/agent-tokens/<old-jti>` (or the
   revoke button in Settings). Revocation is immediate — the blocklist is
   checked on every request.
5. If a token may have **leaked**, invert the order: revoke first, accept the
   agent downtime, then mint. And remember `JWT_SECRET` rotation is the
   nuclear option — it invalidates *every* token and user session at once.

Calendar rotation with `expires_in_days: 90` and a reminder beats revoke-on-
compromise: the token dies even when nobody noticed the leak.

## Container control allowlist

The docker-services compose file routes Atrium's Docker access through an
allow-list proxy. `ATRIUM_ALLOWED_CONTAINERS` (comma-separated container
names) restricts which containers Atrium may start/stop/restart/read logs of.
**Empty means every container on the host**, and the proxy now logs a loud
warning at boot when that is the case:

```yaml
# docker-compose.docker-services.yml consumes:
ATRIUM_ALLOWED_CONTAINERS: "my-app,my-app-db"
```

Ephemeral test-runner jobs (`atrium-job-*`) are governed separately by
`ATRIUM_RUNNER_IMAGES` — see docs/testing-junit.md.
