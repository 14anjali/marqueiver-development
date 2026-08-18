# Marqueiver — Frontend (React + Vite + Tailwind)

A **fully working** frontend for the Marqueiver marketplace, wired to the
`marqueiver-js` backend. Real login, routing, live data, and working escrow
actions — not a static mockup.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

Set the backend URL in `.env` (already created):

```
VITE_API_URL=http://localhost:4000
```

Start the backend too (in the marqueiver-js folder): `cd server && npm install && npm run dev`.
Then open http://localhost:5173 — you'll land on the login page.

### Logging in (mock mode)

1. Pick **Brand** or **Creator**, enter any phone (a default is prefilled).
2. Click **Send code** — in mock mode the backend returns the OTP and the app
   prefills it (`123456`).
3. Click **Verify & continue** — you're in.

If the backend is offline, the discovery page still renders from bundled sample
data (clearly labelled), so the UI is never blank.

## What's included (all routed & clickable)

| Route | Page |
|-------|------|
| `/login` | OTP login / signup (brand or creator) |
| `/dashboard` | Stats, recent deals, quick actions |
| `/discover` | Creator search — live filters, sort, pagination, clickable cards |
| `/creator/:id` | Full creator profile + **Invite to Campaign** (creates a real deal) |
| `/brand`, `/brand/:id` | Brand profile (Nike) |
| `/campaigns` | Campaign grid (apply / manage) |
| `/deals` | All deals, filterable by state |
| `/deals/:id` | Deal detail with **working escrow actions** + chat |
| `/messages` | Two-pane messaging |
| `/notifications` | Notification feed |
| `/profile` | Editable profile (saves to backend) |

### The escrow flow actually works

On a deal detail page, the action buttons drive the backend's 10-state machine:
fund escrow → start work → submit → approve & release (or request revision /
cancel & refund). Each move hits the API and updates the timeline. The buttons
shown depend on your role and the deal's current state.

## Structure

```
src/
├── lib/
│   ├── api.js         # full backend client (auth, discovery, deals, messages…)
│   ├── auth.jsx       # auth context (token + user in localStorage)
│   ├── normalize.js   # maps backend docs → UI card shape
│   └── ui-state.jsx   # toasts, loading / error / empty blocks
├── components/        # AppShell (nav), CreatorCard, icons, ui atoms
├── pages/             # all 11 pages above
├── data/sample.js     # fallback/sample data mirroring the designs
└── App.jsx            # router + auth gating
```

## Notes

- Auth is stored in `localStorage`; protected routes redirect to `/login`.
- Portrait/cover images use Unsplash URLs — swap `src/data/sample.js` for real assets.
- Desktop-first, as requested. Layouts are responsive but not yet mobile-pixel-tuned.
- Messages/Notifications use sample threads where the backend has no seeded data;
  Deals, Discovery, Profile and the escrow actions use live backend data.
