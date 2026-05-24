/**
 * Verification wrapper around @agnic/mandate-verifier with the offline-finale
 * mechanism.
 *
 * The package resolves the issuer key by fetching the did:web document. We pass
 * a custom `fetch` backed by a cache pre-seeded with our DID document — exactly
 * the real-world pattern (a merchant caches the issuer's public key). When
 * `offline` is true the wrapper refuses any live network call and serves only
 * from cache, demonstrating that issuer downtime does not block verification.
 */
import { verifyIntentBundle, type IntentBundleCheck } from '@agnic/mandate-verifier/intent';
import { decodeJwt } from 'jose';
import { didDocument, didJsonUrl, type Env } from './config.js';

/**
 * Precise failure classification.
 *
 * The verifier collapses any signature-or-expiry failure from `jose.jwtVerify`
 * into a single "Invalid issuer signature" message, so an expired credential
 * and a forged one are indistinguishable in its raw reasons. We decode `exp`
 * (without verifying) to tell them apart and emit an accurate, human reason.
 */
export type ReasonCode =
  | 'approved'
  | 'expired'
  | 'forged_signature'
  | 'wrong_merchant'
  | 'over_limit'
  | 'category_out_of_scope'
  | 'parent_mismatch'
  | 'unverified';

const REASON_TEXT: Record<ReasonCode, string> = {
  approved: 'Authorized — within the limits the user signed.',
  expired: 'The authorization credential has expired.',
  forged_signature: 'The mandate signature is not from the trusted issuer (forged).',
  wrong_merchant: 'Merchant is not in the user’s approved list.',
  over_limit: 'Amount exceeds the user’s per-purchase cap.',
  category_out_of_scope: 'Purchase category is outside the user’s authorization.',
  parent_mismatch: 'Transaction is not linked to the user’s authorization.',
  unverified: 'The mandate could not be verified.',
};

function isExpired(sdJwt: string): boolean {
  try {
    const payload = decodeJwt(sdJwt.split('~')[0]);
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();
  } catch {
    return false;
  }
}

function classify(template: string, derivation: string, r: IntentBundleCheck): ReasonCode {
  if (r.valid) return 'approved';
  const c = r.checks;
  if (!c.template_signature) return isExpired(template) ? 'expired' : 'forged_signature';
  if (!c.derivation_signature) return isExpired(derivation) ? 'expired' : 'forged_signature';
  if (!c.not_expired) return 'expired';
  if (!c.parent_match) return 'parent_mismatch';
  if (!c.merchant_in_scope) return 'wrong_merchant';
  if (!c.amount_in_scope) return 'over_limit';
  if (!c.categories_in_scope) return 'category_out_of_scope';
  return 'unverified';
}

export interface ExpectedOrder {
  expectedMerchant: string;
  expectedAmount: { value: string; currency: string };
  expectedCategories?: string[];
}

/**
 * Build a fetch implementation seeded with the issuer DID document.
 * - online:  try the live network; fall back to cache on failure.
 * - offline: serve only from cache; throw on any cache miss (issuer is "down").
 */
function makeCachingFetch(env: Env, offline: boolean): { fetch: typeof fetch; issuerContacted: () => boolean } {
  const url = didJsonUrl(env.ISSUER_DID);
  const cache = new Map<string, string>();
  cache.set(url, JSON.stringify(didDocument(env.ISSUER_DID)));
  let contactedIssuer = false;

  const impl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (offline) {
      const cached = cache.get(target);
      if (cached !== undefined) {
        return new Response(cached, { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`issuer unreachable (offline): ${target}`);
    }

    const cachedHit = () => {
      const cached = cache.get(target);
      return cached !== undefined
        ? new Response(cached, { status: 200, headers: { 'content-type': 'application/json' } })
        : null;
    };
    try {
      contactedIssuer = true;
      const res = await fetch(input, init);
      if (res.ok) {
        cache.set(target, await res.clone().text());
        return res;
      }
      // Issuer reachable but returned an error (or same-worker loopback is
      // blocked): fall back to the cached DID document if we have it.
      return cachedHit() ?? res;
    } catch {
      const fallback = cachedHit();
      if (fallback) return fallback;
      throw new Error(`fetch failed and no cache for ${target}`);
    }
  }) as typeof fetch;

  return { fetch: impl, issuerContacted: () => contactedIssuer };
}

export interface VerifyOutcome extends IntentBundleCheck {
  offline: boolean;
  issuerContacted: boolean;
  reasonCode: ReasonCode;
  reasonText: string;
}

function emptyChecks(): VerifyOutcome['checks'] {
  return { template_signature: false, derivation_signature: false, parent_match: false, not_expired: false, amount_in_scope: false, merchant_in_scope: false, categories_in_scope: false };
}

/**
 * Security preflight before crypto verification:
 *  - Pin the issuer to env.ISSUER_DID — blocks did:web substitution / SSRF via a forged `iss`
 *    (the package resolves the issuer key from the unverified `iss` claim otherwise).
 *  - Reject unexpected SD-JWT disclosures — our issuer emits none, and disclosures are NOT
 *    covered by the signature, so an appended orphan disclosure could override the signed scope.
 */
function preflight(templateSdJwt: string, derivationSdJwt: string, env: Env): string | null {
  for (const [name, sdJwt] of [['template', templateSdJwt], ['derivation', derivationSdJwt]] as const) {
    const parts = sdJwt.split('~');
    if (parts.slice(1).some((p) => p.length > 0)) return `${name}: unexpected disclosures rejected`;
    try {
      if (decodeJwt(parts[0]).iss !== env.ISSUER_DID) return `${name}: untrusted issuer`;
    } catch {
      return `${name}: unparseable credential`;
    }
  }
  return null;
}

export async function verifyBundle(
  env: Env,
  templateSdJwt: string,
  derivationSdJwt: string,
  expected: ExpectedOrder,
  offline = false,
): Promise<VerifyOutcome> {
  const blocked = preflight(templateSdJwt, derivationSdJwt, env);
  if (blocked) {
    return { valid: false, checks: emptyChecks(), reasons: [blocked], offline, issuerContacted: false, reasonCode: 'forged_signature', reasonText: REASON_TEXT.forged_signature };
  }
  const { fetch: cachingFetch, issuerContacted } = makeCachingFetch(env, offline);
  const result = await verifyIntentBundle(templateSdJwt, derivationSdJwt, expected, {
    fetch: cachingFetch,
    skipStatusCheck: true, // our demo credentials carry no revocation list
  });
  const reasonCode = classify(templateSdJwt, derivationSdJwt, result);
  return {
    ...result,
    offline,
    issuerContacted: issuerContacted(),
    reasonCode,
    reasonText: REASON_TEXT[reasonCode],
  };
}
