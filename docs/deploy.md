# Deploying Atrium beyond localhost

[docs/install.md](install.md) gets Atrium running on your machine. This page
is about *reaching it from somewhere else* — your phone on the couch, a
laptop on the same tailnet, or (rarely the right call) the public internet.
Every pattern here builds on the Phase-5 hardening described in
[docs/security-remote.md](security-remote.md); read that page for the *why*,
this one for the *how*.

The short version of the trust model: Atrium speaks plain HTTP and expects
something in front of it to own transport security. Auth (JWT + rate limits +
CORS) protects the API; TLS protects the transport; you bring the TLS.

---

## Pattern 1 — Tailnet only (recommended)

The sweet spot for a personal task board: reachable from all your devices,
invisible to the internet, no certificates to manage yourself.

```bash
# On the host running Atrium (container on port 3100):
tailscale serve --bg 3100
```

Tailscale terminates TLS with a certificate for your `*.ts.net` name and
proxies to localhost. Every device on your tailnet can now open
`https://<host>.<tailnet>.ts.net`.

- **`ATRIUM_TRUST_PROXY`**: leave **unset**. `tailscale serve` connects from
  loopback, but the auth rate limiter keying per-proxy only matters when many
  users share the entry point — on a personal tailnet you are the only
  client. Set `ATRIUM_TRUST_PROXY=true` if you do want per-device keying.
- **`ALLOWED_ORIGINS`**: not needed. The browser talks to the `ts.net` name
  and Atrium sees a same-origin request (Origin host == Host header), which
  is always allowed.
- Works identically for the native run — serve whatever port the backend
  listens on.

## Pattern 2 — LAN, no TLS (trusted network only)

`docker compose up -d` already binds the published port on `0.0.0.0`, so
other machines on your LAN can hit `http://<host-ip>:3100` with no further
setup. Same-origin CORS covers it.

Be honest about what this is: **JWTs travel in cleartext**. Anyone who can
sniff the network segment can replay your session. Fine for a home LAN you
control; not fine for shared office Wi-Fi. If in doubt, use Pattern 1 — a
tailnet costs nothing and removes the caveat.

## Pattern 3 — Public hostname behind Caddy (or nginx)

For a real deployment on a VPS or exposed home server. Caddy shown because
its TLS is automatic; the nginx translation is mechanical.

```caddyfile
board.example.com {
    reverse_proxy localhost:3100
}
```

Backend environment (compose `environment:` block or `.env`):

```bash
NODE_ENV=production          # the container sets this already
ATRIUM_TRUST_PROXY=true     # exactly one proxy hop → rate limiter keys per client
```

- **`ALLOWED_ORIGINS`**: still not needed when Caddy serves both the SPA and
  the API from one hostname (same-origin). Only set it if the frontend lives
  on a *different* origin than the API — then list that origin explicitly.
  In production an empty allowlist means "no cross-origin browser access",
  by design.
- **WebSockets**: `reverse_proxy` handles the socket.io upgrade out of the
  box. For nginx you need the usual `Upgrade`/`Connection` header block on
  the `/socket.io/` location.
- **Do not** also expose the raw port — firewall it so the proxy is the only
  way in.

Checklist for anything public-facing (details in
[security-remote.md](security-remote.md)):

- [ ] `ATRIUM_TRUST_PROXY` matches your real hop count
- [ ] Passwords are 12+ (enforced) and unique
- [ ] Agent tokens minted with `expires_in_days`, rotation on a calendar
- [ ] `ATRIUM_ALLOWED_CONTAINERS` set if the Docker proxy sidecar is enabled
- [ ] `ATRIUM_RUNNER_IMAGES` empty unless you actively use container test jobs

## Pattern 4 — SSH tunnel (zero installs, occasional use)

When you just need the board from one remote machine occasionally:

```bash
ssh -N -L 3100:localhost:3100 user@atrium-host
# then open http://localhost:3100 locally
```

Everything rides the SSH transport; Atrium sees a loopback client. No env
changes at all.

---

## What NOT to do

- **Don't** port-forward the raw HTTP port through your router to the
  internet. There is no TLS and the auth limiter alone is not a perimeter.
- **Don't** set `ATRIUM_TRUST_PROXY` when nothing proxies — a spoofed
  `X-Forwarded-For` would let a client dodge the login rate limit.
- **Don't** re-add localhost origins to `ALLOWED_ORIGINS` in production to
  "fix" a CORS error — a CORS error on a proxied deploy almost always means
  the frontend and API are on different origins unintentionally.

## MCP and agents over the network

The MCP server (`backend/mcp/`) talks to `ATRIUM_URL` with an agent token.
Point it at whichever entry point you exposed:

```bash
ATRIUM_URL=https://board.example.com ATRIUM_API_TOKEN=<agent-token> ...
```

Agent tokens ride the `Authorization` header, so they get TLS wherever the
browser does. Requests without an `Origin` header (all agent traffic) pass
CORS untouched — no allowlist entry required.
