/**
 * "Talk to Sage" — turns a senior's spoken request into a verified action.
 *
 * Flow: transcript → parse intent → build a mandate derivation → verify against
 * the signed scope → plain-language reply.
 *
 * Intent parsing uses the Agnic AI Gateway (Gemini, OpenAI-compatible) when an
 * AGNIC_API_TOKEN is configured, and falls back to deterministic keyword
 * matching otherwise — so the feature always works, and gets smarter with the
 * token. The verifier is always the real @agnic/mandate-verifier.
 */
import { mintTemplate, mintDerivation, type Money, type MandateScope } from './issuer.js';
import { verifyBundle } from './verify.js';
import { MARGARET_SCOPE, MERCHANT_LABELS, PROVIDER_CATEGORY, type Env } from './config.js';

interface ApprovedMerchant { id: string; label: string; category: string }

/** Keyword hints per provider for the no-LLM fallback parser. */
const PROVIDER_KEYWORDS: Record<string, RegExp> = {
  'sunrise-pharmacy': /prescription|pharmacy|medication|medicine|refill|drug|pills/,
  'fresh-grocer': /grocer|groceries|food|supermarket|milk|bread/,
  'city-hydro': /hydro|electric|electricity|utility|power|\bbill\b/,
};

/** Representative amount per category when none is spoken (kept under a typical cap). */
const DEFAULT_AMOUNT: Record<string, number> = { pharmacy: 32, grocery: 25, utility: 45, other: 20 };

export interface SageIntent {
  understood: boolean;
  merchantId: string;
  merchantLabel: string;
  amount: Money;
  category: string;
  restate: string;
}

export interface SageAnswer {
  understood: boolean;
  transcript: string;
  intent?: SageIntent;
  sageSays: string;
  outcome?: 'approved' | 'blocked';
  result?: Awaited<ReturnType<typeof verifyBundle>>;
  parsedBy: 'agnic-gateway' | 'keywords';
}

/** Safe default model (Gemini Flash has safety filters — right for seniors). */
export const DEFAULT_MODEL = 'google/gemini-3.5-flash';

/** Curated, senior-appropriate subset shown in the optional model picker. We
 *  intersect this with Agnic's live catalog so we never offer a 404 model. */
export const CURATED_MODELS: { id: string; label: string }[] = [
  { id: 'google/gemini-3.5-flash', label: 'Standard — Gemini (recommended)' },
  { id: '~anthropic/claude-haiku-latest', label: 'Careful — Claude Haiku' },
  { id: '~openai/gpt-mini-latest', label: 'Fast — GPT mini' },
  { id: '~google/gemini-flash-latest', label: 'Gemini (always latest)' },
  { id: 'deepseek/deepseek-v4-flash', label: 'Economical — DeepSeek' },
];

const money = (v: number): Money => ({ value: v.toFixed(2), currency: 'CAD' });

function wordsToAmount(text: string): number | null {
  const digits = text.replace(/,/g, '').match(/\$?\s?(\d+(?:\.\d{1,2})?)/);
  if (digits) return Number(digits[1]);
  const words: Record<string, number> = {
    'two hundred': 200, 'one hundred': 100, hundred: 100,
    fifty: 50, forty: 40, thirty: 30, twenty: 20, ten: 10, five: 5,
  };
  for (const k of Object.keys(words)) if (text.includes(k)) return words[k];
  return null;
}

/** Deterministic fallback parser — scope-aware (matches the senior's approved providers). */
export function parseIntentKeywords(transcript: string, approved: ApprovedMerchant[]): SageIntent {
  const t = transcript.toLowerCase();
  const amt = wordsToAmount(t);

  // Scam pattern → an unknown payee (will be blocked by the verifier).
  if (/\bcra\b|revenue agency|\btax(es)?\b|gift card|arrest|medicare/.test(t)) {
    const label = MERCHANT_LABELS['cra-collections'];
    return { understood: true, merchantId: 'cra-collections', merchantLabel: label, amount: money(amt ?? 40), category: 'other', restate: `Pay ${label} $${(amt ?? 40).toFixed(2)}` };
  }
  // Match against the user's actual approved providers.
  for (const m of approved) {
    const re = PROVIDER_KEYWORDS[m.id];
    if (re && re.test(t)) {
      const value = amt ?? DEFAULT_AMOUNT[m.category] ?? 20;
      return { understood: true, merchantId: m.id, merchantLabel: m.label, amount: money(value), category: m.category, restate: `Pay ${m.label} $${value.toFixed(2)}` };
    }
  }
  return { understood: false, merchantId: '', merchantLabel: '', amount: money(0), category: '', restate: '' };
}

/** Agnic AI Gateway (Gemini) intent parser. Returns null on any failure so the caller falls back. */
async function parseIntentLLM(env: Env, transcript: string, token: string, model: string, approved: ApprovedMerchant[], cap: string): Promise<SageIntent | null> {
  const list = approved.map((m) => `"${m.id}" (label "${m.label}", category "${m.category}")`).join('; ') || '(none)';
  const system = `You are Sage, an assistant for a senior. Convert the user's spoken request into a JSON payment intent.
Approved merchants the user can pay: ${list}. Per-purchase limit: $${cap} CAD.
If the request clearly matches an approved merchant, use its EXACT id, label, and category from that list. If it's anyone else (tax/CRA/gift-card/unknown payee), set merchantId to a short slug, give a human merchantLabel, and category "other".
Output ONLY minified JSON: {"understood":bool,"merchantId":str,"merchantLabel":str,"amount":{"value":"0.00","currency":"CAD"},"category":str,"restate":str}. If you can't tell what they want, set understood=false.`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (env.AGNIC_PARTNER_ID) headers['X-Partner-Id'] = env.AGNIC_PARTNER_ID;

  const res = await fetch('https://api.agnic.ai/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: transcript },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;
  const json = content.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(json) as SageIntent;
  if (typeof parsed.understood !== 'boolean') return null;
  if (parsed.understood && (!parsed.merchantId || !parsed.amount?.value)) return null;
  parsed.amount = { value: Number(parsed.amount.value).toFixed(2), currency: 'CAD' };
  return parsed;
}

export async function parseIntent(env: Env, transcript: string, userToken?: string, model?: string, scope?: MandateScope): Promise<{ intent: SageIntent; parsedBy: SageAnswer['parsedBy'] }> {
  const activeScope = scope ?? MARGARET_SCOPE;
  const approved: ApprovedMerchant[] = activeScope.merchant_whitelist.map((id) => ({
    id, label: MERCHANT_LABELS[id] ?? id, category: PROVIDER_CATEGORY[id] ?? 'other',
  }));
  const cap = activeScope.max_per_tx.value;

  // Prefer the signed-in user's token (bills their wallet, $5 credit), else our API token.
  const token = userToken ?? env.AGNIC_API_TOKEN;
  const chosenModel = model || env.AGNIC_MODEL || DEFAULT_MODEL;
  if (token) {
    try {
      const llm = await parseIntentLLM(env, transcript, token, chosenModel, approved, cap);
      if (llm) return { intent: llm, parsedBy: 'agnic-gateway' };
    } catch {
      /* fall through to keywords */
    }
  }
  return { intent: parseIntentKeywords(transcript, approved), parsedBy: 'keywords' };
}

export function sageReply(code: string, merchantLabel: string, amountValue: string, capValue: string): string {
  switch (code) {
    case 'approved':
      return `Done — I paid ${merchantLabel} $${amountValue} for you. That was within the limits you set.`;
    case 'wrong_merchant':
      return `I stopped this. ${merchantLabel} is not one of your approved places, so I did not pay. If someone is pressuring you to pay, it may be a scam.`;
    case 'over_limit':
      return `I did not pay this. It is $${amountValue}, but your limit is $${capValue} per purchase. If this is right, you can approve it yourself.`;
    case 'expired':
      return `I did not use that — your approval had expired, so I asked for a fresh one to keep you safe.`;
    case 'forged_signature':
      return `I blocked this — the request was not properly signed, so it could not be trusted.`;
    default:
      return `I could not safely complete that, so I did nothing.`;
  }
}

export async function askSage(env: Env, transcript: string, offline = false, userToken?: string, scope?: MandateScope, model?: string): Promise<SageAnswer> {
  const { intent, parsedBy } = await parseIntent(env, transcript, userToken, model, scope);

  if (!intent.understood) {
    return {
      understood: false,
      transcript,
      parsedBy,
      sageSays: `I'm sorry, I didn't quite catch that. You can say things like "pay my prescription", "buy my groceries", or "someone from the CRA wants gift cards".`,
    };
  }

  // If no amount was stated ("grab my medication"), use a representative amount
  // for the category — in production this comes from the merchant's bill/invoice.
  if (!intent.amount || Number(intent.amount.value) <= 0) {
    const def = DEFAULT_AMOUNT[intent.category] ?? 20;
    intent.amount = { value: def.toFixed(2), currency: 'CAD' };
    intent.restate = `Pay ${intent.merchantLabel} $${def.toFixed(2)}`;
  }

  const tpl = await mintTemplate(env, scope ? { scope } : {});
  const der = await mintDerivation(env, {
    parentJti: tpl.jti,
    intent: { amount: intent.amount, merchant: intent.merchantId, categories: [intent.category] },
  });
  const result = await verifyBundle(env, tpl.sdJwt, der, {
    expectedMerchant: intent.merchantId,
    expectedAmount: intent.amount,
    expectedCategories: [intent.category],
  }, offline);

  return {
    understood: true,
    transcript,
    intent,
    parsedBy,
    outcome: result.valid ? 'approved' : 'blocked',
    result,
    sageSays: sageReply(result.reasonCode, intent.merchantLabel, intent.amount.value, scope?.max_per_tx.value ?? MARGARET_SCOPE.max_per_tx.value),
  };
}
