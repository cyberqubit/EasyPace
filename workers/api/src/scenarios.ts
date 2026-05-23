/**
 * The demo scenarios. Each builds a template + derivation + expected order,
 * runs verification, and returns a senior-facing plain-language narrative
 * alongside the raw verifier result.
 *
 * Maps to the Trust track's required rejection cases:
 *   approved      → a legitimate purchase passes
 *   scam-merchant → rejection: merchant not authorized (the scam)
 *   over-limit    → rejection: amount exceeds the per-purchase cap
 *   expired       → rejection: authorization has expired
 *   impostor      → rejection: invalid issuer signature (forged mandate)
 */
import { mintTemplate, mintDerivation } from './issuer.js';
import { verifyBundle, type VerifyOutcome } from './verify.js';
import { MARGARET_SCOPE, type Env } from './config.js';

export type ScenarioName = 'approved' | 'scam-merchant' | 'over-limit' | 'expired' | 'impostor';

export const SCENARIOS: ScenarioName[] = ['approved', 'scam-merchant', 'over-limit', 'expired', 'impostor'];

export interface ScenarioResult {
  scenario: ScenarioName;
  title: string;
  /** What Margaret asked Sage to do. */
  request: string;
  /** Sage's plain-language verdict to Margaret. */
  sageSays: string;
  outcome: 'approved' | 'blocked';
  result: VerifyOutcome;
}

export async function runScenario(env: Env, name: ScenarioName, offline = false): Promise<ScenarioResult> {
  switch (name) {
    case 'approved': {
      const tpl = await mintTemplate(env);
      const der = await mintDerivation(env, {
        parentJti: tpl.jti,
        intent: { amount: { value: '32.00', currency: 'CAD' }, merchant: 'sunrise-pharmacy', categories: ['pharmacy'] },
      });
      const result = await verifyBundle(env, tpl.sdJwt, der,
        { expectedMerchant: 'sunrise-pharmacy', expectedAmount: { value: '32.00', currency: 'CAD' }, expectedCategories: ['pharmacy'] }, offline);
      return {
        scenario: name,
        title: 'Prescription refill',
        request: 'Sage, please pay for my prescription refill at Sunrise Pharmacy.',
        sageSays: 'Done — I paid Sunrise Pharmacy $32.00 for your prescription. This was within the limits you set.',
        outcome: 'approved',
        result,
      };
    }

    case 'scam-merchant': {
      const tpl = await mintTemplate(env);
      const der = await mintDerivation(env, {
        parentJti: tpl.jti,
        intent: { amount: { value: '40.00', currency: 'CAD' }, merchant: 'cra-collections', categories: ['pharmacy'] },
      });
      const result = await verifyBundle(env, tpl.sdJwt, der,
        { expectedMerchant: 'cra-collections', expectedAmount: { value: '40.00', currency: 'CAD' }, expectedCategories: ['pharmacy'] }, offline);
      return {
        scenario: name,
        title: 'Blocked a scam',
        request: 'A caller said: pay the Canada Revenue Agency $40 in gift cards now, or face arrest.',
        sageSays: 'I stopped this. The "Canada Revenue Agency" caller is not one of your approved places, so I did not pay. The real CRA never demands payment by phone or gift cards.',
        outcome: 'blocked',
        result,
      };
    }

    case 'over-limit': {
      const tpl = await mintTemplate(env);
      const der = await mintDerivation(env, {
        parentJti: tpl.jti,
        intent: { amount: { value: '200.00', currency: 'CAD' }, merchant: 'sunrise-pharmacy', categories: ['pharmacy'] },
      });
      const result = await verifyBundle(env, tpl.sdJwt, der,
        { expectedMerchant: 'sunrise-pharmacy', expectedAmount: { value: '200.00', currency: 'CAD' }, expectedCategories: ['pharmacy'] }, offline);
      return {
        scenario: name,
        title: 'Over your limit',
        request: 'Sage, pay Sunrise Pharmacy $200.00.',
        sageSays: `I did not pay this. It is $200.00, but you set a limit of $${MARGARET_SCOPE.max_per_tx.value} per purchase. If this is right, you can approve it yourself.`,
        outcome: 'blocked',
        result,
      };
    }

    case 'expired': {
      const tpl = await mintTemplate(env);
      const der = await mintDerivation(env, {
        parentJti: tpl.jti,
        intent: { amount: { value: '32.00', currency: 'CAD' }, merchant: 'sunrise-pharmacy', categories: ['pharmacy'] },
        ttlSeconds: -60, // already expired
      });
      const result = await verifyBundle(env, tpl.sdJwt, der,
        { expectedMerchant: 'sunrise-pharmacy', expectedAmount: { value: '32.00', currency: 'CAD' }, expectedCategories: ['pharmacy'] }, offline);
      return {
        scenario: name,
        title: 'Permission expired',
        request: 'Sage, use last month\'s approval to pay Sunrise Pharmacy $32.00.',
        sageSays: 'I did not use that. Your approval for this had expired, so I asked for a fresh one to keep you safe.',
        outcome: 'blocked',
        result,
      };
    }

    case 'impostor': {
      const tpl = await mintTemplate(env);
      const der = await mintDerivation(env, {
        parentJti: tpl.jti,
        intent: { amount: { value: '32.00', currency: 'CAD' }, merchant: 'sunrise-pharmacy', categories: ['pharmacy'] },
        impostor: true,
      });
      const result = await verifyBundle(env, tpl.sdJwt, der,
        { expectedMerchant: 'sunrise-pharmacy', expectedAmount: { value: '32.00', currency: 'CAD' }, expectedCategories: ['pharmacy'] }, offline);
      return {
        scenario: name,
        title: 'Blocked a fake agent',
        request: 'Another program tried to pay using a forged permission in your name.',
        sageSays: 'I blocked this. The request was not signed by your real approval, so it could not be trusted.',
        outcome: 'blocked',
        result,
      };
    }
  }
}
