# Marqueiver — Node/Express Backend (JavaScript, ES Modules)

AI-powered creator ↔ brand marketplace with escrow-based deal workflow.
Ground-up rebuild on **MongoDB · Express · React · Node**, written in modern JavaScript (ES modules, Node 18+).

This repo delivers the **backend-heavy production foundation** described in the
Engineering Proposal (16 July 2026): complete API, data model, 10-state deal/escrow
state machine, auth, and every core module scaffolded with real logic. Paid
third-party integrations (Razorpay, Twilio, Meta, AI) are **wired with env-based
config and mock fallbacks**, so the whole thing runs locally with zero real keys.

---

## What's here

```
marqueiver/
├── server/                 # Node + Express + TypeScript API
│   ├── src/
│   │   ├── config/         # env, db, logger
│   │   ├── models/         # 11 Mongoose collections (proposal §7)
│   │   ├── modules/        # domain modules (auth, deals, discovery, …)
│   │   ├── middleware/     # auth guard, RBAC, validation, error handler
│   │   ├── services/       # integration adapters (razorpay, twilio, meta, ai, email, storage)
│   │   ├── utils/          # helpers (tokens, otp, apiError, catchAsync)
│   │   └── app.ts / server.ts
│   ├── .env.example
│   └── package.json
├── shared/                 # shared TS types (frontend + backend)
├── client-min/             # minimal React panels (proof-of-integration)
└── docs/                   # client questions & assumptions doc
```

## Module ↔ proposal mapping

| Proposal section | Implemented in |
|---|---|
| §5.1 Creator Panel | `modules/users`, `modules/discovery`, `modules/deals` |
| §5.2 Brand Panel | `modules/users`, `modules/discovery`, `modules/deals` |
| §5.3 Admin Panel | `modules/admin` |
| §6 Auth | `modules/auth` + `services/twilio` + `services/oauth` |
| §6 Discovery & search | `modules/discovery` (faceted, `$in` batched) |
| §6 Deals & escrow engine | `modules/deals` (10-state machine + Mongo txns) |
| §6 Messaging | `modules/messaging` (Socket.io) |
| §6 AI analysis | `modules/ai` + `services/ai` (provider-agnostic) |
| §6 Payments | `modules/payments` + `services/razorpay` (escrow ledger) |
| §6 Notifications | `modules/notifications` + `services/email`, `services/twilio` |
| §6 Reviews | `modules/reviews` |
| §6 Admin audit | `middleware/audit` + `models/AdminAuditLog` |
| §7 Database design | `models/*` |
| §8 Integrations | `services/*` |

## Run it

```bash
cd server
cp .env.example .env          # defaults run in MOCK mode, no real keys needed
npm install
npm run dev                   # node --watch, starts on :4000, seeds on first run
# or: npm start                for a plain run without file watching
```

Then:
```bash
curl http://localhost:4000/health
npm run seed                  # optional: (re)load sample creators, brands, deals
```

No MongoDB installed locally? Set `USE_MEMORY_DB=true` in `.env` and it spins up
an in-memory Mongo automatically.

## Design principles carried from the proposal (§4.1)

- **Deploy-region alignment** — documented in `config/env.ts` (Atlas region check).
- **Batched lookups** — all list views use a single `$in`, never per-row fan-out.
- **JIT user sync** — read-then-skip-write on dashboard nav.
- **AI provider abstraction** — swap OpenAI/Gemini via `AI_PROVIDER` env only.
- **Shared code** — enums and constants live in `shared/` and are imported by the server (and any future frontend).
- **Mongo multi-doc transactions** around every money-moving state change.
