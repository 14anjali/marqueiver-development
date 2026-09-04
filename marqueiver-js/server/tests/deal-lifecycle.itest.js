/**
 * Scope §11, §12, §14, §19 — the deal lifecycle and negotiation history,
 * exercised end to end against a real database.
 *
 * The point of §19's "test campaign/deal state transitions so invalid actions
 * cannot be performed" is that the state machine must hold under direct API
 * calls, not just in the UI. Every invalid move here is attempted over HTTP.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, resetDb, makeUser, call } from './helpers.js';
import { Deal } from '../src/models/index.js';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDb);

async function invite(brand, creatorId, amount = 100000) {
  const res = await call('POST', '/api/deals', {
    token: brand.token,
    body: { creator: creatorId, title: 'Monsoon launch', amount, deliverables: '2 reels' },
  });
  assert.ok(res.status < 300, `invite failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

test('an invite is recorded as offer #1, not just as terms', async () => {
  const brand = await makeUser('brand');
  const creator = await makeUser('creator');
  const deal = await invite(brand, creator.id);

  const got = await call('GET', `/api/deals/${deal._id}`, { token: creator.token });
  const offers = got.body.data.offers;
  assert.equal(offers.length, 1);
  assert.equal(offers[0].seq, 1);
  assert.equal(offers[0].byRole, 'brand');
  assert.equal(offers[0].status, 'proposed');
});

test('a counter-offer preserves the previous offer', async () => {
  // §11: "Previous offers must remain in negotiation history and must not be
  // silently overwritten."
  const brand = await makeUser('brand');
  const creator = await makeUser('creator');
  const deal = await invite(brand, creator.id, 100000);

  const counter = await call('POST', `/api/deals/${deal._id}/offers`, {
    token: creator.token,
    body: { amount: 160000, deliverables: '2 reels, 3 stories' },
  });
  assert.ok(counter.status < 300, `counter failed: ${counter.status}`);

  const got = await call('GET', `/api/deals/${deal._id}`, { token: brand.token });
  const offers = got.body.data.offers;
  assert.equal(offers.length, 2, 'both versions must survive');
  assert.equal(offers[0].amount, 100000, 'the original amount must still be readable');
  assert.equal(offers[0].status, 'superseded');
  assert.equal(offers[1].amount, 160000);

  // Binding terms must not move until something is accepted.
  assert.equal(got.body.data.terms.amount, 100000);
});

test('you cannot counter your own outstanding offer', async () => {
  const brand = await makeUser('brand');
  const creator = await makeUser('creator');
  const deal = await invite(brand, creator.id);

  const res = await call('POST', `/api/deals/${deal._id}/offers`, {
    token: brand.token, body: { amount: 90000 },
  });
  assert.equal(res.status, 422, 'silently revising your own live offer must be refused');
});

test('accepting an offer locks that version as the binding terms', async () => {
  const brand = await makeUser('brand');
  const creator = await makeUser('creator');
  const deal = await invite(brand, creator.id, 100000);

  await call('POST', `/api/deals/${deal._id}/offers`, {
    token: creator.token, body: { amount: 145000, deliverables: '2 reels, 3 stories' },
  });

  let got = await call('GET', `/api/deals/${deal._id}`, { token: brand.token });
  const open = got.body.data.offers.find((o) => o.status === 'proposed');

  const acc = await call('POST', `/api/deals/${deal._id}/offers/${open._id}/accept`, {
    token: brand.token,
  });
  assert.ok(acc.status < 300, `accept failed: ${acc.status} ${JSON.stringify(acc.body)}`);

  got = await call('GET', `/api/deals/${deal._id}`, { token: brand.token });
  assert.equal(got.body.data.state, 'accepted');
  assert.equal(got.body.data.terms.amount, 145000);
  assert.ok(got.body.data.terms.acceptedOffer, 'terms must record which offer they came from');
});

test('you cannot accept your own offer', async () => {
  const brand = await makeUser('brand');
  const creator = await makeUser('creator');
  const deal = await invite(brand, creator.id);
  const got = await call('GET', `/api/deals/${deal._id}`, { token: brand.token });
  const own = got.body.data.offers[0];

  const res = await call('POST', `/api/deals/${deal._id}/offers/${own._id}/accept`, {
    token: brand.token,
  });
  assert.equal(res.status, 422);
});

test('terms cannot be renegotiated once the deal is funded', async () => {
  const brand = await makeUser('brand');
  const creator = await makeUser('creator');
  const deal = await invite(brand, creator.id);
  await Deal.updateOne({ _id: deal._id }, { state: 'escrow_funded' });

  const res = await call('POST', `/api/deals/${deal._id}/offers`, {
    token: creator.token, body: { amount: 999999 },
  });
  assert.equal(res.status, 422, 'agreed terms must not be reopened after funding');
});

test('a legacy deal with no offers can still be advanced', async () => {
  // Deals created before offers[] existed must get a backfilled, addressable
  // opening offer rather than becoming permanently stuck.
  const brand = await makeUser('brand');
  const creator = await makeUser('creator');
  const legacy = await Deal.create({
    brand: brand.id, creator: creator.id, title: 'Legacy',
    terms: { amount: 90000, deliverables: '1 reel', revisionsAllowed: 1 },
    state: 'negotiating', offers: [],
  });

  const got = await call('GET', `/api/deals/${legacy.id}`, { token: creator.token });
  const offers = got.body.data.offers;
  assert.equal(offers.length, 1);
  assert.ok(offers[0]._id, 'the backfilled offer needs a real id to be acceptable');
  assert.equal(offers[0].reconstructed, true);

  const acc = await call('POST', `/api/deals/${legacy.id}/offers/${offers[0]._id}/accept`, {
    token: creator.token,
  });
  assert.ok(acc.status < 300, `legacy accept failed: ${acc.status}`);
});

test('a non-party cannot negotiate on a deal', async () => {
  const brand = await makeUser('brand');
  const creator = await makeUser('creator');
  const stranger = await makeUser('creator');
  const deal = await invite(brand, creator.id);

  const res = await call('POST', `/api/deals/${deal._id}/offers`, {
    token: stranger.token, body: { amount: 1 },
  });
  assert.equal(res.status, 403);
});

test('only a brand can create a deal', async () => {
  const creator = await makeUser('creator');
  const other = await makeUser('creator');
  const res = await call('POST', '/api/deals', {
    token: creator.token,
    body: { creator: other.id, title: 'x', amount: 1000, deliverables: 'y' },
  });
  assert.equal(res.status, 403);
});

test('escrow cannot be funded before terms are accepted', async () => {
  const brand = await makeUser('brand');
  const creator = await makeUser('creator');
  const deal = await invite(brand, creator.id);

  const res = await call('POST', `/api/deals/${deal._id}/payment-session`, { token: brand.token });
  assert.equal(res.status, 422, 'funding an unaccepted deal must be refused');
});
