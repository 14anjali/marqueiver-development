# QA gates

    cd marqueiver-js/server && ./qa/run.sh

Five gates. Each one exists because something got past code review:

| Gate | Catches | The incident |
|---|---|---|
| `xref.mjs` | a module importing a name another does not export | `fb.facebookConfigStatus is not a function` — 500 on every Facebook connect, and `looksLikeMissingGrant` throwing *inside* the Instagram error handler, hiding the real error for days |
| `contract.mjs` | frontend calling a route the server does not serve, or with the wrong method | boots the real Express app and walks its router stack, so it sees the composed reality rather than what a routes file appears to say |
| `authcover.mjs` | a route mounted without `authenticate` | `GET /auth/instagram` had no auth; `POST /admin/bootstrap` sat above the admin auth wall and minted super-admin tokens to anonymous callers |
| unit suite | everything with a test | 265 tests |
| payment guard | a production deploy that would take mock payments | every Cashfree call falls back to a mock branch when unconfigured — deals would be marked funded with no money received |

`authcover.mjs` carries an allowlist of routes that are public **by design**, each
with its reason. That is deliberate: a heuristic ("it has 'callback' in the
name") is how an unauthenticated route sneaks in. Adding a public route means
adding a line and stating why.

Two suites cannot run here and are not part of the gate:
`tests/*.itest.js` need a real MongoDB.
