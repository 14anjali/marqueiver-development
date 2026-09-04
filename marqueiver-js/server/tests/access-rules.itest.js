/**
 * Scope §10 and §13 — role-aware and state-aware authorization, tested by
 * **direct API calls**, which is what §19 asks for. Hiding a section in the UI
 * is explicitly not sufficient, so every case here bypasses the frontend
 * entirely and hits the route.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, resetDb, makeUser, call } from './helpers.js';
import { Deal } from '../src/models/index.js';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDb);

/* ── §10 Discovery ────────────────────────────────────────────────────── */

test('creator cannot list the creator directory', async () => {
  const { token } = await makeUser('creator');
  const res = await call('GET', '/api/discovery/creators', { token });
  assert.equal(res.status, 403, 'a creator must not be able to browse other creators');
});

test('brand can list creators', async () => {
  const { token } = await makeUser('brand');
  const res = await call('GET', '/api/discovery/creators', { token });
  assert.equal(res.status, 200);
});

test('brand cannot list the brand directory', async () => {
  const { token } = await makeUser('brand');
  const res = await call('GET', '/api/discovery/brands', { token });
  assert.equal(res.status, 403, 'brands must not get other brands as their discovery experience');
});

test('creator can look up a specific brand profile', async () => {
  // The rule is about directories, not about resolving a counterpart.
  const { token } = await makeUser('creator');
  const res = await call('GET', '/api/discovery/brands', { token });
  assert.equal(res.status, 200);
});

test('unauthenticated discovery is rejected', async () => {
  const res = await call('GET', '/api/discovery/creators');
  assert.equal(res.status, 401);
});

test('creator cannot export the creator list', async () => {
  const { token } = await makeUser('creator');
  const res = await call('GET', '/api/discovery/creators/export', { token });
  assert.equal(res.status, 403, 'export must not be a way around the directory rule');
});

/* ── §13 Messaging ────────────────────────────────────────────────────── */

async function makeDeal(state, brandId, creatorId) {
  return Deal.create({
    brand: brandId,
    creator: creatorId,
    title: 'Test campaign',
    terms: { amount: 50000, deliverables: '1 reel', revisionsAllowed: 1 },
    state,
  });
}

test('messaging is blocked before escrow, by direct API call', async () => {
  const brand = await makeUser('brand');
  const creator = await makeUser('creator');

  for (const state of ['invited', 'negotiating']) {
    const deal = await makeDeal(state, brand.id, creator.id);

    const send = await call('POST', `/api/messages/${deal.id}`, {
      token: creator.token, body: { body: 'hello' },
    });
    assert.equal(send.status, 403, `sending must be blocked at "${state}"`);
    assert.equal(send.body?.error?.code ?? send.body?.code, 'MESSAGING_LOCKED');

    const read = await call('GET', `/api/messages/${deal.id}`, { token: brand.token });
    assert.equal(read.status, 403, `reading must be blocked at "${state}"`);
  }
});

test('messaging opens once escrow is funded', async () => {
  const brand = await makeUser('brand');
  const creator = await makeUser('creator');
  const deal = await makeDeal('escrow_funded', brand.id, creator.id);

  const res = await call('POST', `/api/messages/${deal.id}`, {
    token: creator.token, body: { body: 'starting today' },
  });
  assert.ok(res.status < 300, `expected success, got ${res.status}`);
});

test('a stranger cannot read or send on someone else\'s deal', async () => {
  const brand = await makeUser('brand');
  const creator = await makeUser('creator');
  const stranger = await makeUser('creator');
  const deal = await makeDeal('in_progress', brand.id, creator.id);

  const read = await call('GET', `/api/messages/${deal.id}`, { token: stranger.token });
  assert.equal(read.status, 403);

  const send = await call('POST', `/api/messages/${deal.id}`, {
    token: stranger.token, body: { body: 'let me in' },
  });
  assert.equal(send.status, 403);
});

test('markRead cannot be called on a deal you are not part of', async () => {
  // This was an unauthorized endpoint before the scope-alignment pass.
  const brand = await makeUser('brand');
  const creator = await makeUser('creator');
  const stranger = await makeUser('brand');
  const deal = await makeDeal('in_progress', brand.id, creator.id);

  const res = await call('POST', `/api/messages/${deal.id}/read`, { token: stranger.token });
  assert.equal(res.status, 403);
});
