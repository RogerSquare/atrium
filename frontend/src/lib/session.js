// Session expiry detection (bug-auth-expiry-detect-001).
//
// The board previously had NO 401 handling anywhere and restored the user from
// localStorage without validating the token. A 24-hour-old token therefore
// looked identical to a fresh one until a request failed, and nothing caught
// the failure — so the app sat there against a dead session and the only way
// back was a manual logout.
//
// Everything here is pure and takes `now` explicitly, so expiry behaviour is
// tested without waiting 24 hours or mocking the clock.

/**
 * Decode a JWT payload WITHOUT verifying it.
 *
 * Verification is the server's job and cannot be done here — the client has no
 * secret. This reads `exp` only to decide when to stop trusting a token
 * locally, which is a UX decision, never an authorization one. A forged token
 * still fails server-side; the worst a tampered `exp` can do is make this
 * client log out early or late.
 */
export function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    // base64url -> base64, then pad. atob rejects unpadded base64url.
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

/** Expiry in ms since epoch, or null when the token has none. */
export function expiryMs(token) {
  const payload = decodeJwtPayload(token)
  if (!payload || typeof payload.exp !== 'number') return null
  return payload.exp * 1000
}

/**
 * Whether a token should be treated as expired.
 *
 * A token with NO exp is treated as valid: agent tokens can be minted without
 * one, and refusing them here would break a working setup to fix a different
 * problem. An unparseable token IS expired — it cannot work anyway.
 */
export function isExpired(token, now = Date.now(), skewMs = 0) {
  if (typeof token !== 'string' || token === '') return true
  const payload = decodeJwtPayload(token)
  if (!payload) return true
  if (typeof payload.exp !== 'number') return false
  return payload.exp * 1000 <= now + skewMs
}

/** Milliseconds until expiry; 0 if already expired, Infinity if no exp. */
export function msUntilExpiry(token, now = Date.now()) {
  const exp = expiryMs(token)
  if (exp === null) return decodeJwtPayload(token) ? Infinity : 0
  return Math.max(0, exp - now)
}

/**
 * Should this response be read as "the user's session ended"?
 *
 * Deliberately narrow. A 401 from an agent-token call, or a 403 (authenticated
 * but not permitted), must NOT tear down a perfectly good user session — that
 * would turn a permissions error into a surprise logout. Only a 401 counts,
 * and only on a request that carried the user's own session token.
 */
export function isSessionExpiredResponse(status, { usedSessionToken = true } = {}) {
  return status === 401 && usedSessionToken
}

/**
 * Read the stored session, dropping it if the token is already dead.
 *
 * This is the difference between "the app notices on the next click" and "the
 * app never shows a broken board at all".
 */
export function loadStoredSession(storage, now = Date.now()) {
  let raw
  try {
    raw = storage?.getItem('taskBoardUser')
  } catch {
    return { user: null, expired: false }
  }
  if (!raw) return { user: null, expired: false }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Corrupt entry — drop it rather than crashing the provider on boot.
    return { user: null, expired: false, drop: true }
  }

  if (!parsed?.token) {
    // A stored user with no token cannot authenticate anything.
    return { user: null, expired: false, drop: true }
  }
  if (isExpired(parsed.token, now)) {
    return { user: null, expired: true, drop: true }
  }
  return { user: parsed, expired: false }
}
