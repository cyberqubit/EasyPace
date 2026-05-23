/** API client for the Sage verifier Worker. */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

// ── Agnic sign-in session (opaque id in localStorage; sent as Bearer) ──
const SESSION_KEY = 'easypace_session';
export function getSession(): string | null {
  return localStorage.getItem(SESSION_KEY);
}
export function captureSession(): string | null {
  const params = new URLSearchParams(location.search);
  const s = params.get('session');
  if (s) {
    localStorage.setItem(SESSION_KEY, s);
    params.delete('session');
    const qs = params.toString();
    history.replaceState({}, '', location.pathname + (qs ? `?${qs}` : ''));
  }
  return getSession();
}
export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}
function authHeaders(): Record<string, string> {
  const s = getSession();
  return s ? { authorization: `Bearer ${s}` } : {};
}
export const signInUrl = (): string => `${API_BASE}/api/auth/login`;

export interface Me {
  signedIn: boolean;
  balance?: { usdcBalance?: string; creditBalance?: string; totalBalance?: string; address?: string };
  user?: Record<string, unknown>;
}
export async function authMe(): Promise<Me> {
  const res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() });
  return res.json();
}
export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', headers: authHeaders() });
  clearSession();
}

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

export type Scope = Mandate['scope'];

export async function getMandate(): Promise<Mandate> {
  const res = await fetch(`${API_BASE}/api/mandate`);
  if (!res.ok) throw new Error('Could not load mandate');
  return res.json();
}

export async function runScenario(name: ScenarioName, offline: boolean, scope?: Scope): Promise<ScenarioResult> {
  const res = await fetch(`${API_BASE}/api/demo/${name}${offline ? '?offline=true' : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope }),
  });
  if (!res.ok) throw new Error(`Scenario failed: ${name}`);
  return res.json();
}

export interface AskResult {
  understood: boolean;
  transcript?: string;
  sageSays: string;
  outcome?: 'approved' | 'blocked';
  result?: VerifyOutcome;
  parsedBy?: 'agnic-gateway' | 'keywords';
  intent?: { merchantLabel: string; amount: { value: string; currency: string } };
}

export async function askSage(transcript: string, offline: boolean, scope?: Scope, model?: string): Promise<AskResult> {
  const res = await fetch(`${API_BASE}/api/sage/ask${offline ? '?offline=true' : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ transcript, scope, model }),
  });
  return res.json();
}

export interface ModelOption { id: string; label: string }
export async function getModels(): Promise<{ default: string; models: ModelOption[] }> {
  const res = await fetch(`${API_BASE}/api/models`);
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
