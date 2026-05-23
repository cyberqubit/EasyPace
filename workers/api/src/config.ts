/**
 * EasyPace / Sage — issuer configuration and the standing "Margaret" mandate.
 *
 * We act as our OWN did:web issuer for the demo: the public key below is
 * published at /.well-known/did.json, and the mandate credentials are signed
 * with the matching private key (held only in the ISSUER_PRIVATE_JWK secret).
 * This lets us deterministically demonstrate every accept/reject case the
 * Trust track scores, while staying spec-compatible with @agnic/mandate-verifier.
 */
import type { JWK } from 'jose';

/** Public half of the issuer key — safe to commit; published in the DID document. */
export const ISSUER_PUBLIC_JWK: JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'ud2nRiW496-EeK0G_TExcmNjwwOcJ4V6-HhIsMNb0vE',
  y: 'M6KhR9BWGafvMA1HW0-VDTmCGaASEeUHfPnRuKeT5F0',
  kid: 'easypace-issuer-1',
  alg: 'ES256',
};

export const KEY_ID = 'easypace-issuer-1';

/** SD-JWT-VC type identifiers. */
export const VCT_TEMPLATE = 'https://agnic.ai/vct/IntentMandateTemplate';
export const VCT_DERIVATION = 'https://agnic.ai/vct/IntentMandateDerivation';

/**
 * Margaret's standing authorization, set once (with her family's help):
 * "Sage may spend up to $50 per purchase, only at approved pharmacy and
 * grocery merchants." This is the scope every transaction is checked against.
 */
export const MARGARET_SCOPE = {
  categories: ['pharmacy', 'grocery'],
  max_per_tx: { value: '50.00', currency: 'USD' },
  merchant_whitelist: ['sunrise-pharmacy', 'fresh-grocer'],
} as const;

/** Plain-language labels for merchants, for the senior-facing UI. */
export const MERCHANT_LABELS: Record<string, string> = {
  'sunrise-pharmacy': 'Sunrise Pharmacy',
  'fresh-grocer': 'Fresh Grocer',
  'medicare-renewal-dept': '"Medicare Renewal Department" (unknown)',
};

/** Convert a did:web identifier to its DID-document URL. */
export function didJsonUrl(did: string): string {
  const m = did.match(/^did:web:(.+)$/);
  if (!m) throw new Error(`Not a did:web identifier: ${did}`);
  const [domain, ...path] = m[1].split(':');
  const host = decodeURIComponent(domain);
  const suffix = path.length ? `/${path.map(decodeURIComponent).join('/')}` : '';
  return `https://${host}${suffix}/.well-known/did.json`;
}

/** Build the DID document served at /.well-known/did.json. */
export function didDocument(issuerDid: string) {
  return {
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/jwk/v1'],
    id: issuerDid,
    verificationMethod: [
      {
        id: `${issuerDid}#${KEY_ID}`,
        type: 'JsonWebKey2020',
        controller: issuerDid,
        publicKeyJwk: ISSUER_PUBLIC_JWK,
      },
    ],
    assertionMethod: [`${issuerDid}#${KEY_ID}`],
  };
}

export interface Env {
  ISSUER_DID: string;
  ISSUER_PRIVATE_JWK: string;
}
