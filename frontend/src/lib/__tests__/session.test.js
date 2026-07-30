// Unit tests for session expiry (bug-auth-expiry-detect-001).
//
// Two behaviours matter most, and both are about NOT over-reacting:
//   - a 403, or a 401 from an agent-token call, must never log the user out;
//     turning a permissions error into a surprise logout is worse than the bug
//   - a token with no `exp` must stay valid, because agent tokens can be
//     minted without one

import { describe, it, expect } from 'vitest'
import {
  decodeJwtPayload,
  expiryMs,
  isExpired,
  msUntilExpiry,
  isSessionExpiredResponse,
  loadStoredSession,
} from '../session'

// Minimal unsigned JWT — the signature is irrelevant, this never verifies.
const makeToken = (payload) => {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`
}

const NOW = 1_700_000_000_000
const secs = (ms) => Math.floor(ms / 1000)

describe('decodeJwtPayload', () => {
  it('decodes the payload', () => {
    expect(decodeJwtPayload(makeToken({ username: 'roger', exp: 123 })))
      .toEqual({ username: 'roger', exp: 123 })
  })

  it('handles base64url payloads that need padding', () => {
    const token = makeToken({ username: 'a'.repeat(5), exp: 1 })
    expect(decodeJwtPayload(token)?.exp).toBe(1)
  })

  it('returns null for junk instead of throwing', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull()
    expect(decodeJwtPayload('a.b')).toBeNull()
    expect(decodeJwtPayload('')).toBeNull()
    expect(decodeJwtPayload(null)).toBeNull()
    expect(decodeJwtPayload('a.!!!.c')).toBeNull()
  })
})

describe('isExpired', () => {
  it('is false well before expiry', () => {
    expect(isExpired(makeToken({ exp: secs(NOW) + 3600 }), NOW)).toBe(false)
  })

  it('is true after expiry', () => {
    expect(isExpired(makeToken({ exp: secs(NOW) - 1 }), NOW)).toBe(true)
  })

  it('treats the exact expiry instant as expired', () => {
    expect(isExpired(makeToken({ exp: secs(NOW) }), NOW)).toBe(true)
  })

  it('honours a skew so a token about to die is not used', () => {
    const token = makeToken({ exp: secs(NOW) + 30 })
    expect(isExpired(token, NOW)).toBe(false)
    expect(isExpired(token, NOW, 60_000)).toBe(true)
  })

  // Agent tokens can be minted without exp; rejecting them here would break a
  // working setup while fixing an unrelated problem.
  it('treats a token with NO exp as valid', () => {
    expect(isExpired(makeToken({ username: 'agent' }), NOW)).toBe(false)
  })

  it('treats missing or malformed tokens as expired', () => {
    expect(isExpired('', NOW)).toBe(true)
    expect(isExpired(null, NOW)).toBe(true)
    expect(isExpired('garbage', NOW)).toBe(true)
  })
})

describe('msUntilExpiry', () => {
  it('reports the remaining time', () => {
    expect(msUntilExpiry(makeToken({ exp: secs(NOW) + 60 }), NOW)).toBe(60_000)
  })

  it('is 0 once expired, never negative', () => {
    expect(msUntilExpiry(makeToken({ exp: secs(NOW) - 500 }), NOW)).toBe(0)
  })

  it('is Infinity when there is no exp', () => {
    expect(msUntilExpiry(makeToken({ username: 'agent' }), NOW)).toBe(Infinity)
  })

  it('is 0 for an undecodable token', () => {
    expect(msUntilExpiry('garbage', NOW)).toBe(0)
  })
})

describe('isSessionExpiredResponse', () => {
  it('treats a 401 on a session-token request as expiry', () => {
    expect(isSessionExpiredResponse(401)).toBe(true)
  })

  // The important negatives — over-reacting here is worse than under-reacting.
  it('does NOT treat a 401 from an agent-token call as user expiry', () => {
    expect(isSessionExpiredResponse(401, { usedSessionToken: false })).toBe(false)
  })

  it('does NOT treat 403 as expiry — that is a permissions error', () => {
    expect(isSessionExpiredResponse(403)).toBe(false)
  })

  it('ignores success and server errors', () => {
    for (const s of [200, 204, 304, 400, 404, 500, 502]) {
      expect(isSessionExpiredResponse(s)).toBe(false)
    }
  })
})

describe('loadStoredSession', () => {
  const store = (value) => ({ getItem: () => value })

  it('returns the user when the token is live', () => {
    const user = { username: 'roger', token: makeToken({ exp: secs(NOW) + 3600 }) }
    const out = loadStoredSession(store(JSON.stringify(user)), NOW)
    expect(out.user.username).toBe('roger')
    expect(out.expired).toBe(false)
  })

  // The whole point: previously this was trusted blindly, so the board rendered
  // against a dead session until something failed.
  it('rejects an expired token on load and flags it as expiry', () => {
    const user = { username: 'roger', token: makeToken({ exp: secs(NOW) - 10 }) }
    const out = loadStoredSession(store(JSON.stringify(user)), NOW)
    expect(out.user).toBeNull()
    expect(out.expired).toBe(true)
    expect(out.drop).toBe(true)
  })

  it('drops a stored user with no token, without calling it an expiry', () => {
    const out = loadStoredSession(store(JSON.stringify({ username: 'roger' })), NOW)
    expect(out.user).toBeNull()
    expect(out.expired).toBe(false)
    expect(out.drop).toBe(true)
  })

  it('drops corrupt JSON rather than throwing during provider boot', () => {
    const out = loadStoredSession(store('{not json'), NOW)
    expect(out.user).toBeNull()
    expect(out.drop).toBe(true)
  })

  it('handles an empty store', () => {
    expect(loadStoredSession(store(null), NOW)).toEqual({ user: null, expired: false })
  })

  it('survives storage throwing', () => {
    const throwing = { getItem: () => { throw new Error('disabled') } }
    expect(loadStoredSession(throwing, NOW)).toEqual({ user: null, expired: false })
  })
})
