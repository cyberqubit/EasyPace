/**
 * The demo scenarios. Each defines a fixed transaction (merchant/amount), runs
 * it through the REAL verifier against the (possibly edited) mandate scope, and
 * reports the outcome + Sage's plain-language verdict derived from the actual
 * verification — so editing the Permissions panel (limit, approved providers)
 * changes the outcome live.
 *
 * Track rejection cases: approved · scam-merchant (wrong merchant) ·
 * over-limit (amount) · expired · impostor (forged signature).
 */
import { mintTemplate, mintDerivation, type MandateScope } from './issuer.js';
import { verifyBundle, type VerifyOutcome } from './verify.js';
import { sageReply } from './sage.js';
import { MARGARET_SCOPE, MERCHANT_LABELS, type Env } from './config.js';

export type ScenarioName = 'approved' | 'scam-merchant' | 'over-limit' | 'expired' | 'impostor';

export const SCENARIOS: ScenarioName[] = ['approved', 'scam-merchant', 'over-limit', 'expired', 'impostor'];

interface ScenarioDef {
  merchant: string;
  amount: string;
  category: string;
  title: string;
  request: string;
  ttlSeconds?: number;
  impostor?: boolean;
}

const DEFS: Record<ScenarioName, ScenarioDef> = {
  approved: {
    merchant: 'sunrise-pharmacy', amount: '32.00', category: 'pharmacy',
    title: 'Prescription refill',
    request: 'Sage, please pay for my prescription refill at Sunrise Pharmacy.',
  },
  'scam-merchant': {
    merchant: 'cra-collections', amount: '40.00', category: 'pharmacy',
    title: 'A scam call',
    request: 'A caller said: pay the Canada Revenue Agency $40 in gift cards now, or face arrest.',
  },
  'over-limit': {
    merchant: 'sunrise-pharmacy', amount: '200.00', category: 'pharmacy',
    title: 'A large charge',
    request: 'Sage, pay Sunrise Pharmacy $200.00.',
  },
  expired: {
    merchant: 'sunrise-pharmacy', amount: '32.00', category: 'pharmacy',
    title: "Last month's approval",
    request: "Sage, use last month's approval to pay Sunrise Pharmacy $32.00.",
    ttlSeconds: -60,
  },
  impostor: {
    merchant: 'sunrise-pharmacy', amount: '32.00', category: 'pharmacy',
    title: 'A fake agent',
    request: 'Another program tried to pay using a forged permission in your name.',
    impostor: true,
  },
};

export interface ScenarioResult {
  scenario: ScenarioName;
  title: string;
  request: string;
  sageSays: string;
  outcome: 'approved' | 'blocked';
  result: VerifyOutcome;
}

export async function runScenario(env: Env, name: ScenarioName, offline = false, scope?: MandateScope): Promise<ScenarioResult> {
  const d = DEFS[name];
  const amount = { value: d.amount, currency: 'CAD' };

  const tpl = await mintTemplate(env, scope ? { scope } : {});
  const der = await mintDerivation(env, {
    parentJti: tpl.jti,
    intent: { amount, merchant: d.merchant, categories: [d.category] },
    ttlSeconds: d.ttlSeconds,
    impostor: d.impostor,
  });
  const result = await verifyBundle(env, tpl.sdJwt, der,
    { expectedMerchant: d.merchant, expectedAmount: amount, expectedCategories: [d.category] }, offline);

  const cap = scope?.max_per_tx.value ?? MARGARET_SCOPE.max_per_tx.value;
  return {
    scenario: name,
    title: d.title,
    request: d.request,
    sageSays: sageReply(result.reasonCode, MERCHANT_LABELS[d.merchant] ?? d.merchant, d.amount, cap),
    outcome: result.valid ? 'approved' : 'blocked',
    result,
  };
}
