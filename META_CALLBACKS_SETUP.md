# Meta callbacks — Deauthorize & Data Deletion

What to paste into the Meta App Dashboard, and what the endpoints actually do.

---

## 1. The URLs

Replace `https://api.marqueiver.com` with whatever `API_URL` is in that
environment. Meta requires **HTTPS** and a **publicly reachable host** — it will
not accept `localhost`, and it verifies the URL by calling it during setup.

### Facebook app → **Settings → Basic**

| Field | Value |
|---|---|
| Deauthorize Callback URL | `https://api.marqueiver.com/api/auth/facebook/deauthorize` |
| Data Deletion Request URL | `https://api.marqueiver.com/api/auth/facebook/data-deletion` |

### Instagram app → **Instagram → API setup** (or **Basic Display**, depending on how the app is configured)

| Field | Value |
|---|---|
| Deauthorize Callback URL | `https://api.marqueiver.com/api/auth/instagram/deauthorize` |
| Data Deletion Request URL | `https://api.marqueiver.com/api/auth/instagram/data-deletion` |

If the dashboard offers a **Data Deletion Instructions URL** instead of a
callback URL (some app types do), point it at the public page:

```
https://app.marqueiver.com/data-deletion
```

…which is `CLIENT_URL` + `/data-deletion`.

---

## 2. Environment variables

**No new variables.** The callbacks are verified with the app secrets the social
connect integration already uses:

```
FACEBOOK_APP_SECRET=     # verifies the Facebook callbacks
INSTAGRAM_APP_SECRET=    # verifies the Instagram callbacks
API_URL=                 # the host the four URLs above are built from
CLIENT_URL=              # the host the status page lives on
```

Two things that will bite in production if they are wrong:

- **`CLIENT_URL` must be the public site.** The URL returned to the person is
  `{CLIENT_URL}/data-deletion?code=…`. If it still says `localhost`, Meta gets a
  link that goes nowhere and app review fails on it.
- **With the app secret unset, the callbacks reject everything.** That is
  deliberate — they fail closed rather than accepting unverified requests — but
  it means a deploy that is missing the secret looks to Meta like a broken
  endpoint rather than a misconfigured one.

`INSTAGRAM_APP_SECRET` is tried first for the Instagram callbacks, with
`FACEBOOK_APP_SECRET` as a fallback, because which one signs the request depends
on whether the app uses Instagram Login or Facebook Login. Both secrets are ours,
so accepting either widens nothing.

---

## 3. What the endpoints do

### Authentication

There is none, and there cannot be: Meta calls these server-to-server, with no
browser, no session and no token. The **`signed_request` HMAC is the entire
security** — it is verified with the app secret before the payload is read for
anything. Without that check, anyone on the internet could POST a user id and
have that person's connection and data deleted.

Verification is constant-time, length-checked, rejects a payload that names its
own algorithm as anything but HMAC-SHA256, and covers the *encoded* payload
string using **base64url** — the two details that otherwise fail silently on
roughly half of live requests.

### Deauthorize

The person removed the app in Facebook or Instagram. Our tokens are dead from
that moment, so the connection record is removed along with everything synced
from it. Meta ignores the response body; a `200` is the acknowledgement.

### Data Deletion Request

Same removal, plus Meta's required response — a **bare** JSON object, not the
`{ ok, data }` envelope the rest of the API uses:

```json
{
  "url": "https://app.marqueiver.com/data-deletion?code=K3M9QP2XA7BD",
  "confirmation_code": "K3M9QP2XA7BD"
}
```

The code is stored in `DataDeletionRequest` so the URL resolves later. That
collection holds the platform, the app-scoped provider id, counts of what was
removed and a status — **never** the `signed_request`, and never a copy of the
data being deleted.

A request naming somebody who never connected here is answered the same way and
recorded as `no_data_found`. It is truthful, and returning an error would have
Meta retrying a request that can never succeed.

### What is deleted — and what is not

Removed: the connection record and its access tokens, the synced profile and
audience fields, and the mirrored entry in `CreatorProfile.socialAccounts` that
would otherwise keep the handle and follower count visible in discovery.

**Not** removed: the Marqueiver account, deals, messages, or payment records.
Meta's requirement is to delete the data obtained *from Meta*, not to close the
account — and treating it as account deletion would mean a creator who merely
revoked an app permission (something people do routinely) silently lost their
escrow balance and earnings history, which we are in any case required to retain
for tax and accounting. The public page at `/data-deletion` says this plainly and
points to Profile → Delete account for the other thing.

---

## 4. Before this ships

- [ ] **Backfill `facebookUserId`.** `FacebookPage.facebookPageId` has always
      been populated from Graph `/me`, so it holds the app-scoped *user* id
      rather than a Page id. The new `facebookUserId` field records it under its
      real name and the callback matches on both, so existing rows still resolve
      — but a one-off `updateMany` copying `facebookPageId` into
      `facebookUserId` would let the fallback be retired.
- [ ] **Verify the endpoints are reachable over HTTPS** from outside your
      network before saving them in the dashboard. Meta calls the URL as you
      save it and rejects one that does not answer.
- [ ] **Test from the dashboard.** Facebook's Data Deletion field has a "Send
      test request" button; it should come back with a `url` and a
      `confirmation_code`, and opening the URL should show the status page.

## 5. Verified so far

- 15 unit tests covering the verifier (forged signature, tampered payload,
  `algorithm: none`, malformed input, missing secret, the base64url alphabet,
  and signing the decoded JSON instead of the encoded string) and the response
  contract. Full backend suite: **152 tests, 0 failures** (29 skipped — those
  need MongoDB).
- The four rejection paths were exercised over real HTTP against the assembled
  app: forged signature → `401 SIGNED_REQUEST_INVALID`, missing field → `400
  SIGNED_REQUEST_MISSING`, malformed → `400 SIGNED_REQUEST_MALFORMED`, with no
  stack traces or provider details in any response.
- **Not** verified here: the success path end to end, because it needs MongoDB
  and this environment has none. The removal logic and the status page have not
  been run against a real database or a real Meta request.
