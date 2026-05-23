/**
 * Mandate issuer — mints spec-compatible IntentMandateTemplate and
 * IntentMandateDerivation credentials as SD-JWT-VCs.
 *
 * We emit each credential as a signed ES256 JWT with all claims in the payload
 * (no selective disclosure needed) followed by the SD-JWT separator `~`.
 * @agnic/mandate-verifier parses `parts = sdJwt.split('~')`, treats parts[0] as
 * the issuer JWT, and reads `scope` / `intent` from the payload — so this is a
 * valid, minimal SD-JWT-VC.
 */
import { SignJWT, importJWK, generateKeyPair, type JWK } from 'jose';
import { KEY_ID, VCT_TEMPLATE, VCT_DERIVATION, MARGARET_SCOPE, type Env } from './config.js';

const SEP = '~';

function randomJti(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function importIssuerPrivateKey(env: Env) {
  const jwk = JSON.parse(env.ISSUER_PRIVATE_JWK) as JWK;
  return importJWK(jwk, 'ES256');
}

async function signSdJwt(payload: Record<string, unknown>, key: Awaited<ReturnType<typeof importJWK>>): Promise<string> {
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', typ: 'dc+sd-jwt', kid: KEY_ID })
    .sign(key);
  return `${jwt}${SEP}`;
}

export interface Money {
  value: string;
  currency: string;
}

export interface MintTemplateOpts {
  /** Seconds from now until the template expires. Negative => already expired. */
  ttlSeconds?: number;
  scope?: {
    categories: string[];
    max_per_tx: Money;
    merchant_whitelist: string[];
  };
}

export interface MintedTemplate {
  sdJwt: string;
  jti: string;
}

export async function mintTemplate(env: Env, opts: MintTemplateOpts = {}): Promise<MintedTemplate> {
  const key = await importIssuerPrivateKey(env);
  const now = Math.floor(Date.now() / 1000);
  const jti = randomJti('tpl');
  const sdJwt = await signSdJwt(
    {
      iss: env.ISSUER_DID,
      sub: `${env.ISSUER_DID}#margaret-device`,
      vct: VCT_TEMPLATE,
      jti,
      iat: now,
      exp: now + (opts.ttlSeconds ?? 30 * 24 * 3600),
      scope: opts.scope ?? MARGARET_SCOPE,
    },
    key,
  );
  return { sdJwt, jti };
}

export interface MintDerivationOpts {
  parentJti: string;
  intent: { amount: Money; merchant: string; categories: string[] };
  /** Seconds from now until the derivation expires. Negative => already expired. */
  ttlSeconds?: number;
  stepUp?: boolean;
  /** When true, sign with a throwaway key (impostor / invalid issuer signature). */
  impostor?: boolean;
}

export async function mintDerivation(env: Env, opts: MintDerivationOpts): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: env.ISSUER_DID,
    sub: `${env.ISSUER_DID}#margaret-device`,
    vct: VCT_DERIVATION,
    jti: randomJti('der'),
    parent_jti: opts.parentJti,
    iat: now,
    exp: now + (opts.ttlSeconds ?? 5 * 60),
    intent: opts.intent,
  };
  if (opts.stepUp) payload.step_up = true;

  if (opts.impostor) {
    // Sign with a freshly generated key that is NOT in our DID document, so the
    // verifier's signature check fails — an impostor agent presenting a forged
    // mandate.
    const { privateKey } = await generateKeyPair('ES256', { extractable: true });
    return signSdJwt(payload, privateKey);
  }

  const key = await importIssuerPrivateKey(env);
  return signSdJwt(payload, key);
}
