/**
 * "Sign in with Agnic" — OAuth 2.0 Authorization Code + PKCE.
 *
 * Confidential client (the Worker holds the secret) with PKCE on top. To avoid
 * third-party-cookie problems between our Pages frontend and Workers backend
 * (different domains), the callback hands the browser an opaque SESSION ID in
 * the redirect; the browser stores it and sends it as a Bearer token. Agnic
 * access/refresh tokens never leave the Worker (kept in KV).
 *
 * NOTE: the OAuth client must be APPROVED by Agnic before /oauth/authorize works.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from './config.js';

const AGNIC = 'https://api.agnic.ai';
const SCOPES = 'payments:sign balance:read transactions:read email:read agent:read';
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

type Ctx = Context<{ Bindings: Env }>;

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomB64url(n = 32): string {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return b64url(a);
}
async function sha256b64url(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return b64url(d);
}

interface Session {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope?: string;
}

/** Resolve and (if near expiry) refresh the Agnic access token for the request's session. */
export async function userTokenFromRequest(c: Ctx): Promise<string | null> {
  const header = c.req.header('authorization');
  const sid = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!sid) return null;
  const raw = await c.env.SESSIONS.get(`sess:${sid}`);
  if (!raw) return null;
  const s = JSON.parse(raw) as Session;

  if (s.refresh_token && s.expires_at - Date.now() < 5 * 60 * 1000) {
    try {
      const r = await fetch(`${AGNIC}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: s.refresh_token, client_id: c.env.AGNIC_CLIENT_ID, client_secret: c.env.AGNIC_CLIENT_SECRET }),
      });
      if (r.ok) {
        const t = (await r.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
        s.access_token = t.access_token;
        if (t.refresh_token) s.refresh_token = t.refresh_token;
        s.expires_at = Date.now() + Number(t.expires_in ?? 3600) * 1000;
        await c.env.SESSIONS.put(`sess:${sid}`, JSON.stringify(s), { expirationTtl: SESSION_TTL });
      }
    } catch {
      /* keep existing token */
    }
  }
  return s.access_token;
}

export const auth = new Hono<{ Bindings: Env }>();

auth.get('/login', async (c) => {
  if (!c.env.AGNIC_CLIENT_ID || !c.env.AGNIC_REDIRECT_URI) return c.text('Sign-in is not configured.', 503);
  const verifier = randomB64url(48);
  const challenge = await sha256b64url(verifier);
  const state = randomB64url(24);
  await c.env.SESSIONS.put(`oauth:${state}`, JSON.stringify({ verifier }), { expirationTtl: 600 });

  const u = new URL('/oauth/authorize', AGNIC);
  u.searchParams.set('client_id', c.env.AGNIC_CLIENT_ID);
  u.searchParams.set('redirect_uri', c.env.AGNIC_REDIRECT_URI);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return c.redirect(u.toString());
});

auth.get('/callback', async (c) => {
  const front = c.env.FRONTEND_ORIGIN ?? '/';
  const { code, state, error } = c.req.query();
  if (error) return c.redirect(`${front}/?auth_error=${encodeURIComponent(error)}`);
  if (!code || !state) return c.redirect(`${front}/?auth_error=missing_code`);

  const pending = await c.env.SESSIONS.get(`oauth:${state}`);
  if (!pending) return c.redirect(`${front}/?auth_error=bad_state`);
  const { verifier } = JSON.parse(pending) as { verifier: string };
  await c.env.SESSIONS.delete(`oauth:${state}`);

  const res = await fetch(`${AGNIC}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: c.env.AGNIC_REDIRECT_URI,
      client_id: c.env.AGNIC_CLIENT_ID,
      client_secret: c.env.AGNIC_CLIENT_SECRET,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) return c.redirect(`${front}/?auth_error=token_exchange`);
  const tok = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };

  const sid = randomB64url(32);
  const session: Session = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: Date.now() + Number(tok.expires_in ?? 3600) * 1000,
    scope: tok.scope,
  };
  await c.env.SESSIONS.put(`sess:${sid}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
  return c.redirect(`${front}/?session=${sid}`);
});

auth.get('/me', async (c) => {
  const token = await userTokenFromRequest(c);
  if (!token) return c.json({ signedIn: false });
  const out: Record<string, unknown> = { signedIn: true };
  try {
    const b = await fetch(`${AGNIC}/api/balance`, { headers: { authorization: `Bearer ${token}` } });
    if (b.ok) out.balance = await b.json();
  } catch { /* ignore */ }
  try {
    const u = await fetch(`${AGNIC}/oauth/userinfo`, { headers: { authorization: `Bearer ${token}` } });
    if (u.ok) out.user = await u.json();
  } catch { /* ignore */ }
  return c.json(out);
});

auth.post('/logout', async (c) => {
  const header = c.req.header('authorization');
  const sid = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (sid) await c.env.SESSIONS.delete(`sess:${sid}`);
  return c.json({ ok: true });
});
