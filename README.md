# EasyPace — Sage 🌿

**A trustworthy agentic-commerce assistant for seniors.**
Sage pays, books, and shops on a senior's behalf — but every transaction is cryptographically bound to limits the senior (or their family) signed in advance. No scam merchant, no over-the-limit charge, no expired or forged authorization can get through. And it keeps protecting them **even when the issuer's servers are down.**

> Agnic "Agentic Commerce Pioneers" Hackathon · **Track: Agents You Can Trust**

🔗 **Live demo:** https://easypace-sage.pages.dev
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

The verifier (running on a Cloudflare Worker as a `did:web` issuer + verifier) confirms signatures, expiry, scope containment, and merchant/amount/category — and returns a plain-language verdict that Sage reads aloud.

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

## Accessibility is a build gate, not a feature

The UI is built to research-backed senior-accessibility rules (WCAG 2.2, leaning AAA):
- Body text ≥ 20px, **7:1 contrast**, touch targets ≥ 48px, persistent labels, clear focus rings
- **Voice read-aloud** of every verdict (Web Speech API), one primary action per screen, plain language (no "prompt"/"token"/"mandate" jargon shown to the user)

## Architecture

```
React PWA (Cloudflare Pages)          Cloudflare Worker (Hono)
  Sage UI · voice · a11y     ──HTTPS──▶  did:web issuer + mandate verifier
  easypace-sage.pages.dev               @agnic/mandate-verifier (SD-JWT-VC, did:web,
                                         Bitstring Status List) + offline cache
                                         easypace-api.inboxtoronto.workers.dev
```

- **Frontend:** React + TypeScript PWA, Vite, vite-plugin-pwa — Cloudflare Pages
- **Backend:** Hono on Cloudflare Workers (`nodejs_compat`)
- **Trust core:** `@agnic/mandate-verifier` (offline SD-JWT-VC verifier), `jose`
- **Identity:** Agnic ERC-8004 agent #5085 (Base Sepolia), `did:web` issuer
- **Cost to run:** $0 (Cloudflare free tier; verifier makes no paid calls)

## Run locally

```bash
npm install

# Terminal 1 — verifier Worker (needs workers/api/.dev.vars with ISSUER_PRIVATE_JWK)
cd workers/api && npx wrangler dev --port 8787

# Terminal 2 — PWA (proxies /api to the Worker)
cd apps/web && npm run dev
```

Then open the printed local URL and try the scenarios, including the "issuer online/offline" toggle.

### Verifier endpoints

- `GET  /.well-known/did.json` — issuer DID document
- `GET  /api/mandate` — the senior's standing authorization
- `POST /api/demo/:scenario` — run a scenario (`approved`, `scam-merchant`, `over-limit`, `expired`, `impostor`); `?offline=true` for the finale
- `POST /api/verify` — verify a raw `{ template, derivation, expected }` bundle

## License

MIT © 2026 EasyPace. See [LICENSE](./LICENSE).
