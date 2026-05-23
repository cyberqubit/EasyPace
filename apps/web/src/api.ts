/** API client for the Sage verifier Worker. */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export type ScenarioName = 'approved' | 'scam-merchant' | 'over-limit' | 'expired' | 'impostor';

export interface VerifyOutcome {
  valid: boolean;
  reasonCode: string;
  reasonText: string;
  offline: boolean;
  issuerContacted: boolean;
  template_jti?: string;
  derivation_jti?: string;
  checks: {
    template_signature: boolean;
    derivation_signature: boolean;
    parent_match: boolean;
    not_expired: boolean;
    amount_in_scope: boolean;
    merchant_in_scope: boolean;
    categories_in_scope: boolean;
  };
  reasons: string[];
}

export interface ScenarioResult {
  scenario: ScenarioName;
  title: string;
  request: string;
  sageSays: string;
  outcome: 'approved' | 'blocked';
  result: VerifyOutcome;
}

export interface Mandate {
  holder: string;
  plain: string;
  scope: { categories: string[]; max_per_tx: { value: string; currency: string }; merchant_whitelist: string[] };
  approvedMerchants: { id: string; label: string }[];
}

export async function getMandate(): Promise<Mandate> {
  const res = await fetch(`${API_BASE}/api/mandate`);
  if (!res.ok) throw new Error('Could not load mandate');
  return res.json();
}

export async function runScenario(name: ScenarioName, offline: boolean): Promise<ScenarioResult> {
  const res = await fetch(`${API_BASE}/api/demo/${name}${offline ? '?offline=true' : ''}`, { method: 'POST' });
  if (!res.ok) throw new Error(`Scenario failed: ${name}`);
  return res.json();
}

export const CHECK_LABELS: Record<keyof VerifyOutcome['checks'], string> = {
  template_signature: 'Authorization signed by user',
  derivation_signature: 'Transaction signed by issuer',
  parent_match: 'Linked to user’s authorization',
  not_expired: 'Authorization still valid',
  amount_in_scope: 'Amount within limit',
  merchant_in_scope: 'Merchant approved',
  categories_in_scope: 'Category allowed',
};
