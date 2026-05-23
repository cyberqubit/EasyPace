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
import { askSage } from './sage.js';
import { auth, userTokenFromRequest } from './auth.js';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

app.route('/api/auth', auth);

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

app.post('/api/demo/:scenario', async (c) => {
  const scenario = c.req.param('scenario') as ScenarioName;
  if (!SCENARIOS.includes(scenario)) {
    return c.json({ error: `unknown scenario: ${scenario}`, scenarios: SCENARIOS }, 400);
  }
  const offline = c.req.query('offline') === 'true';
  try {
    const result = await runScenario(c.env, scenario, offline);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'scenario failed' }, 500);
  }
});

app.post('/api/sage/ask', async (c) => {
  const offline = c.req.query('offline') === 'true';
  const body = await c.req.json().catch(() => ({}));
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
  if (!transcript) return c.json({ understood: false, sageSays: 'I didn’t hear anything — please try again.', parsedBy: 'keywords' }, 400);
  try {
    const userToken = (await userTokenFromRequest(c)) ?? undefined;
    return c.json(await askSage(c.env, transcript, offline, userToken));
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
