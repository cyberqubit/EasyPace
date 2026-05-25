# EasyPace — Sage 🌿

**A trustworthy agentic-commerce assistant for seniors.**
Sage pays, books, and shops on a senior's behalf — but every transaction is cryptographically bound to limits the senior (or their family) signed in advance. No scam merchant, no over-the-limit charge, no expired or forged authorization can get through. And it keeps protecting them **even when the issuer's servers are down.**

> Agnic "Agentic Commerce Pioneers" Hackathon · **Track: Agents You Can Trust**

🔗 **Live demo:** https://easypace-sage.pages.dev
🖥️ **Pitch deck:** https://easypace-sage.pages.dev/deck
🔗 **Verifier API:** https://easypace-api.inboxtoronto.workers.dev
🪪 **On-chain agent identity (ERC-8004):** Agnic agent **#5085** (Base Sepolia)

---

## The problem

Autonomous AI agents that *pay* are arriving fast — but they're being built for technical users, not the people most exposed to financial harm. Canadians lose hundreds of millions of dollars to fraud every year, and seniors are hit hardest — with the **CRA "you owe back taxes, pay now or be arrested" phone scam** chief among them, now supercharged by AI voice-cloning. The same agent infrastructure that promises convenience is also a new attack surface.

**EasyPace flips that:** the agent absorbs the complexity, and the senior gets *autonomy through trust* — not autonomy through expertise.

## How it works

When Sage is set up, the senior (with family help) signs a standing **mandate**:

> *"Sage may spend up to **$50 per purchase**, only at **approved pharmacy and grocery** merchants."*

Every time Sage tries to pay, two credentials are checked by [`@agnic/mandate-verifier`](https://www.npmjs.com/package/@agnic/mandate-verifier):

| Credential | What it is |
|---|---|
| **IntentMandateTemplate** | the senior's standing scope (categories, per-tx cap, merchant whitelist), signed by their device |
| **IntentMandateDerivation** | one specific transaction (merchant, amount, category), scope-contained against the template |

The verifier (running on a Cloudflare Worker as a `did:web` issuer + verifier) confirms signatures, expiry, scope containment, and merchant/amount/category — and returns a plain-language verdict that Sage reads aloud. The senior can **just talk** — *"refill my heart medication"* — and Sage understands it via the **Agnic AI Gateway** before running it through the verifier.

### The five demonstrations

| Scenario | Result | Why |
|---|---|---|
| 💊 Prescription refill at approved pharmacy | ✅ **Approved** | within signed limits |
| 📞 "CRA" caller demanding $40 in gift cards | 🛑 **Blocked** | merchant not authorized (the scam) |
| 🛒 $200 at the pharmacy | 🛑 **Blocked** | exceeds the $50/purchase cap |
| 📅 Last month's approval | 🛑 **Blocked** | authorization expired |
| 🕵️ A forged mandate from a fake agent | 🛑 **Blocked** | invalid issuer signature |

### The offline finale 🔌

The verifier caches the issuer's public DID document, so it makes **zero issuer calls at verification time**. Cut the issuer server off mid-demo — Sage *still* approves the legitimate purchase and *still* blocks the scam, from cache. Issuer downtime can never strand a senior or wave a fraud through.

### More that makes it real

- **🎤 Talk to Sage** — speak naturally ("pay my City Hydro bill"); speech→text in the browser, understood via the **Agnic AI Gateway** (real, settled calls), then verified. Falls back to deterministic keyword matching if the gateway is unavailable.
- **⚙️ Family-controlled permissions** — an in-app panel lets the family set the per-purchase limit and toggle approved providers; changes drive the verifier **live** (lower the limit → the next payment is held; add a provider → Sage learns to pay it).
- **🧠 Choose the AI model** — optional picker over Agnic's live model catalog; defaults to a safe Gemini model.
- **🔑 Sign in with Agnic** (OAuth 2.0 + PKCE) — so a user can act on their own Agnic wallet and balance; built and deployed, pending Agnic OAuth-client approval.

## Accessibility is a build gate, not a feature

The UI is built to research-backed senior-accessibility rules (WCAG 2.2, leaning AAA):
- Body text ≥ 20px, **7:1 contrast**, touch targets ≥ 48px, persistent labels, clear focus rings
- **Voice both ways** (Web Speech API): speak to Sage (speech-to-text) and Sage reads every verdict aloud — one primary action per screen, plain language (no "prompt"/"token"/"mandate" jargon shown to the user)

## Business model

Free for seniors and families. EasyPace earns a small partner commission through Agnic **only when Sage completes a task** — we make money by *helping*, never by charging the people we protect. Go-to-market: channels seniors already trust (Senior Planet/OATS, public libraries) plus a "set it up for Mom" family-referral flow. Illustrative unit economics: ~$5/month per active senior → 10,000 users ≈ $600K ARR.

## Security

We ran a self-directed security audit — issuer substitution/SSRF, scope injection, empty-whitelist bypass, orphan-disclosure scope override, prompt injection, and cost-abuse — and **hardened against every Critical/High before submitting**: issuer pinning, server-bounded scope, disclosure rejection, input/transcript limits, model allowlisting. Known production-TODOs (revocation/status-list signature verification, a distributed rate limiter, anti-replay) are documented honestly; in a real deployment **Agnic is the independent credential issuer**, which removes the self-issued demo's trust assumptions. Note: the LLM is advisory — the cryptographic verifier is the trust anchor, so a prompt-injection's worst case is a *blocked* transaction, never an unauthorized approval.

## Status (honest)

Fully working live demo: natural-language voice (real, settled Agnic Gateway calls), one approval + four rejection cases, the offline-resilience finale, and a live family-controlled permissions panel. Mandates are self-issued via our own `did:web` for deterministic demonstration; the verifier is the real `@agnic/mandate-verifier`. **AI calls are real settlements; real-world _merchant_ settlement is modeled**, pending broader x402 merchant coverage. "Sign in with Agnic" is built and deployed, pending Agnic OAuth-client approval.

## Team

**Jose Castellanos** — built EasyPace end-to-end on Agnic. *"I watch my parents getting older and worry every time their phone rings — Sage is the protection I want for them."* Seeking a co-founder with senior-care or fintech-distribution experience.

## Architecture

```
React web app (Cloudflare Pages)      Cloudflare Worker (Hono)
  Sage UI · voice · a11y     ──HTTPS──▶  did:web issuer + mandate verifier
  easypace-sage.pages.dev               @agnic/mandate-verifier (SD-JWT-VC, did:web,
                                         Bitstring Status List) + offline cache
                                         easypace-api.inboxtoronto.workers.dev
```

- **Frontend:** React + TypeScript (Vite) — Cloudflare Pages; always served fresh (no stale cache)
- **Backend:** Hono on Cloudflare Workers (`nodejs_compat`)
- **Trust core:** `@agnic/mandate-verifier` (offline SD-JWT-VC verifier), `jose`
- **AI + auth:** Agnic AI Gateway (natural-language understanding) + Agnic OAuth (sign-in); Cloudflare KV for sessions
- **Identity:** Agnic ERC-8004 agent #5085 (Base Sepolia), `did:web` issuer
- **Cost to run:** ~$0 — Cloudflare free tier; the verifier makes no paid calls. Natural-language voice uses the Agnic AI Gateway (real settled calls, fractions of a cent each).

## Run locally

```bash
npm install

# Terminal 1 — verifier Worker (needs workers/api/.dev.vars with ISSUER_PRIVATE_JWK)
cd workers/api && npx wrangler dev --port 8787

# Terminal 2 — web app (proxies /api to the Worker)
cd apps/web && npm run dev
```

Then open the printed local URL and try the scenarios, including the "issuer online/offline" toggle.

### Verifier endpoints

- `GET  /.well-known/did.json` — issuer DID document
- `GET  /api/mandate` — the senior's standing authorization
- `POST /api/demo/:scenario` — run a scenario (`approved`, `scam-merchant`, `over-limit`, `expired`, `impostor`); accepts an optional edited `{ scope }`; `?offline=true` for the finale
- `POST /api/verify` — verify a raw `{ template, derivation, expected }` bundle
- `POST /api/sage/ask` — natural-language request → intent → verify (`{ transcript, scope?, model? }`)
- `GET  /api/models` — available AI models (curated subset of Agnic's live catalog)
- `GET  /api/auth/login` · `/callback` · `/me` · `POST /api/auth/logout` — Sign in with Agnic (OAuth 2.0 + PKCE)

## License

MIT © 2026 EasyPace. See [LICENSE](./LICENSE).
