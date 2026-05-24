/**
 * EasyPace / Sage — Trust track verifier API (Cloudflare Worker, Hono).
 *
 * Routes:
 *   GET  /health                  — liveness
 *   GET  /.well-known/did.json    — issuer DID document (did:web public key)
 *   GET  /api/mandate             — Margaret's standing authorization (for the UI)
 *   GET  /api/demo/scenarios      — list the demo scenarios
 *   POST /api/demo/:scenario      — run a scenario (?offline=true for the finale)
 *   POST /api/verify              — verify a raw {template, derivation, expected} bundle
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { didDocument, MARGARET_SCOPE, MERCHANT_LABELS, type Env } from './config.js';
import { runScenario, SCENARIOS, type ScenarioName } from './scenarios.js';
import { verifyBundle } from './verify.js';
import { askSage, CURATED_MODELS, DEFAULT_MODEL } from './sage.js';
import { auth, userTokenFromRequest } from './auth.js';
import type { MandateScope } from './issuer.js';
import { PROVIDER_CATEGORY } from './config.js';

const KNOWN_MERCHANTS = new Set(Object.keys(PROVIDER_CATEGORY));
const KNOWN_CATEGORIES = new Set(Object.values(PROVIDER_CATEGORY));
const MAX_CAP = 500; // server-enforced ceiling — the client may tighten scope, never inflate it

/**
 * Parse a caller-supplied mandate scope, BOUNDED by server policy so it can never
 * be used to approve arbitrary merchants or amounts (scope-injection defense):
 *  - merchant_whitelist: keep only server-known providers; unknown ids are dropped;
 *    an empty result becomes a deny-all sentinel (never "allow any").
 *  - categories: only server-known categories.
 *  - max_per_tx: clamped to [0, MAX_CAP].
 * Returns undefined only when no scope is sent (→ default MARGARET_SCOPE).
 */
function parseScope(raw: unknown): MandateScope | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Record<string, unknown>;
  const base = MARGARET_SCOPE;

  let merchant_whitelist: string[] = [...base.merchant_whitelist];
  if (Array.isArray(s.merchant_whitelist)) {
    merchant_whitelist = (s.merchant_whitelist as unknown[]).map(String).filter((id) => KNOWN_MERCHANTS.has(id));
    if (merchant_whitelist.length === 0) merchant_whitelist = ['__no_approved_merchants__'];
  }

  let categories: string[] = [...base.categories];
  if (Array.isArray(s.categories)) {
    categories = (s.categories as unknown[]).map(String).filter((c) => KNOWN_CATEGORIES.has(c));
  }

  const cap = (s.max_per_tx ?? {}) as { value?: unknown; currency?: unknown };
  let value: string = base.max_per_tx.value;
  if (cap.value !== undefined) {
    const n = Number(cap.value);
    value = Number.isFinite(n) ? Math.max(0, Math.min(MAX_CAP, n)).toFixed(2) : base.max_per_tx.value;
  }

  return { categories, merchant_whitelist, max_per_tx: { value, currency: typeof cap.currency === 'string' ? cap.currency : base.max_per_tx.currency } };
}

const app = new Hono<{ Bindings: Env }>();

// Restrict CORS to our own origins (Pages prod + previews + local dev); blocks
// arbitrary third-party browser origins from abusing the API / draining credit.
app.use('*', cors({
  origin: (origin) => {
    if (!origin) return '*';
    if (origin.endsWith('.pages.dev') || origin.startsWith('http://localhost')) return origin;
    return '';
  },
}));

app.route('/api/auth', auth);

app.get('/', (c) =>
  c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EasyPace — Sage Verifier API</title>
<style>body{font-family:system-ui,Arial,sans-serif;max-width:640px;margin:3rem auto;padding:0 1.25rem;line-height:1.6;color:#16261d}a{color:#1b4332}code{background:#f1f7f3;padding:.1rem .35rem;border-radius:6px}h1{font-size:1.6rem}</style></head>
<body>
<h1>🌿 EasyPace — Sage Verifier API</h1>
<p>This is the backend that verifies whether a payment is within the limits a senior signed. <strong>Try the app:</strong></p>
<p>👉 <a href="https://easypace-sage.pages.dev">easypace-sage.pages.dev</a></p>
<h2>Endpoints</h2>
<ul>
<li><code>GET /health</code></li>
<li><code>GET /.well-known/did.json</code></li>
<li><code>GET /api/mandate</code> · <code>GET /api/models</code></li>
<li><code>POST /api/demo/:scenario</code> (?offline=true)</li>
<li><code>POST /api/sage/ask</code> · <code>POST /api/verify</code></li>
</ul>
<p>Code: <a href="https://github.com/cyberqubit/EasyPace">github.com/cyberqubit/EasyPace</a> · Agnic "Agentic Commerce Pioneers" — Trust track.</p>
</body></html>`),
);

app.get('/health', (c) => c.json({ ok: true, service: 'easypace-sage-verifier' }));

app.get('/.well-known/did.json', (c) => c.json(didDocument(c.env.ISSUER_DID)));

app.get('/api/mandate', (c) =>
  c.json({
    holder: 'Margaret',
    plain: `Sage may spend up to $${MARGARET_SCOPE.max_per_tx.value} per purchase, only at approved pharmacy and grocery stores.`,
    scope: MARGARET_SCOPE,
    approvedMerchants: MARGARET_SCOPE.merchant_whitelist.map((id) => ({ id, label: MERCHANT_LABELS[id] ?? id })),
  }),
);

app.get('/api/demo/scenarios', (c) => c.json({ scenarios: SCENARIOS }));

// Available AI models — the curated, senior-appropriate subset, intersected
// with Agnic's live catalog so we never offer a model that 404s.
app.get('/api/models', async (c) => {
  const available = new Set<string>();
  if (c.env.AGNIC_API_TOKEN) {
    try {
      const r = await fetch('https://api.agnic.ai/v1/models', { headers: { authorization: `Bearer ${c.env.AGNIC_API_TOKEN}` } });
      if (r.ok) {
        const j = (await r.json()) as { data?: { id: string }[]; models?: { id: string }[] };
        for (const m of j.data ?? j.models ?? []) available.add(m.id);
      }
    } catch { /* fall back to curated list as-is */ }
  }
  const models = available.size ? CURATED_MODELS.filter((m) => available.has(m.id)) : CURATED_MODELS;
  if (!models.some((m) => m.id === DEFAULT_MODEL)) models.unshift({ id: DEFAULT_MODEL, label: 'Standard — Gemini (recommended)' });
  return c.json({ default: DEFAULT_MODEL, models });
});

app.post('/api/demo/:scenario', async (c) => {
  const scenario = c.req.param('scenario') as ScenarioName;
  if (!SCENARIOS.includes(scenario)) {
    return c.json({ error: `unknown scenario: ${scenario}`, scenarios: SCENARIOS }, 400);
  }
  const offline = c.req.query('offline') === 'true';
  const body = await c.req.json().catch(() => ({}));
  const scope = parseScope(body?.scope);
  try {
    const result = await runScenario(c.env, scenario, offline, scope);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'scenario failed' }, 500);
  }
});

app.post('/api/sage/ask', async (c) => {
  const offline = c.req.query('offline') === 'true';
  const body = await c.req.json().catch(() => ({}));
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim().slice(0, 500) : '';
  if (!transcript) return c.json({ understood: false, sageSays: 'I didn’t hear anything — please try again.', parsedBy: 'keywords' }, 400);
  if (c.env.RL_ASK) {
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'anon';
    const { success } = await c.env.RL_ASK.limit({ key: ip });
    if (!success) return c.json({ understood: false, sageSays: 'One moment please — too many requests just now. Please try again shortly.', parsedBy: 'keywords' }, 429);
  }
  try {
    const userToken = (await userTokenFromRequest(c)) ?? undefined;
    const scope = parseScope(body?.scope);
    // Only allow a model from our curated list; ignore arbitrary caller-supplied model ids.
    const model = typeof body?.model === 'string' && CURATED_MODELS.some((m) => m.id === body.model) ? body.model : undefined;
    return c.json(await askSage(c.env, transcript, offline, userToken, scope, model));
  } catch (err) {
    return c.json({ understood: false, sageSays: 'Something went wrong on my side — let’s try again.', error: err instanceof Error ? err.message : 'error', parsedBy: 'keywords' }, 500);
  }
});

app.post('/api/verify', async (c) => {
  // Either supply the standard `x-intent-mandate: <template>~~<derivation>` header,
  // or a JSON body { template, derivation, expected }.
  const offline = c.req.query('offline') === 'true';
  let template: string | undefined;
  let derivation: string | undefined;
  let expected: { expectedMerchant: string; expectedAmount: { value: string; currency: string }; expectedCategories?: string[] } | undefined;

  const header = c.req.header('x-intent-mandate');
  if (header) {
    [template, derivation] = header.split('~~');
  }
  if (c.req.header('content-type')?.includes('application/json')) {
    const body = await c.req.json().catch(() => ({}));
    template ??= body.template;
    derivation ??= body.derivation;
    expected = body.expected;
  }

  if (!template || !derivation) {
    return c.json({ valid: false, reasons: ['missing mandate: no template/derivation supplied'] }, 400);
  }
  if (!expected) {
    return c.json({ valid: false, reasons: ['missing expected order details'] }, 400);
  }

  const result = await verifyBundle(c.env, template, derivation, expected, offline);
  return c.json(result);
});

export default app;
