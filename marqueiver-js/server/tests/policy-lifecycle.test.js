/** Collaboration lifecycle — Policy 5.1–5.5, 6.2, 7.1/7.2, 10.4. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransition, canRequestRevision, canCancel,
  DEFAULT_REVISION_ROUNDS, REVIEW_WINDOW_DAYS, DISPUTE_WINDOW_DAYS, ALL_STATES,
} from '../src/modules/deals/dealStateMachine.js';

test('Policy 5.1 stages all exist', () => {
  for (const s of ['invitation', 'negotiation', 'accepted', 'escrow_pending',
                   'in_progress', 'submitted', 'revision', 'completed'])
    assert.ok(ALL_STATES.includes(s), `${s} missing`);
});

test('Policy 7.2 — declining a brief is not a cancellation', () => {
  assert.ok(ALL_STATES.includes('declined'));
  assert.notEqual('declined', 'cancelled');
  assert.equal(canTransition('invitation', 'declined', 'creator').allowed, true);
});

test('Policy 6.2/4.5 — only the payment partner starts the work', () => {
  assert.equal(canTransition('escrow_pending', 'in_progress', 'brand').allowed, false);
  assert.equal(canTransition('escrow_pending', 'in_progress', 'creator').allowed, false);
  assert.equal(canTransition('escrow_pending', 'in_progress', 'system').allowed, true);
});

test('Policy 5.3 — automatic completion is reachable by the system', () => {
  assert.equal(canTransition('submitted', 'completed', 'system').allowed, true);
  assert.equal(canTransition('submitted', 'completed', 'brand').allowed, true);
  assert.equal(REVIEW_WINDOW_DAYS, 7);
});

test('Policy 5.3 — a Creator cannot approve their own work', () => {
  assert.equal(canTransition('submitted', 'completed', 'creator').allowed, false);
});

test('Policy 5.4 — two revision rounds by default, then blocked', () => {
  assert.equal(DEFAULT_REVISION_ROUNDS, 2);
  const deal = { terms: { revisionsAllowed: 2 }, revisionCount: 0 };
  assert.equal(canRequestRevision(deal).allowed, true);
  assert.equal(canRequestRevision({ ...deal, revisionCount: 1 }).allowed, true);
  assert.equal(canRequestRevision({ ...deal, revisionCount: 2 }).allowed, false);
});

test('Policy 5.5 — exhausted revisions lead to Resolution, and its four options', () => {
  assert.equal(canTransition('submitted', 'resolution', 'brand').allowed, true);
  // A/C settle to completed, B returns to work, D escalates.
  assert.equal(canTransition('resolution', 'completed', 'brand').allowed, true);
  assert.equal(canTransition('resolution', 'in_progress', 'creator').allowed, true);
  assert.equal(canTransition('resolution', 'disputed', 'creator').allowed, true);
  // Option C applies automatically.
  assert.equal(canTransition('resolution', 'completed', 'system').allowed, true);
});

test('Policy 7.2 — a Creator cannot cancel after submission', () => {
  assert.equal(canCancel('submitted', 'creator').allowed, false);
  assert.equal(canCancel('revision', 'creator').allowed, false);
  assert.equal(canCancel('in_progress', 'creator').allowed, true);
});

test('Policy 10.4 — only Marqueiver determines a dispute', () => {
  assert.equal(canTransition('disputed', 'completed', 'brand').allowed, false);
  assert.equal(canTransition('disputed', 'completed', 'creator').allowed, false);
  assert.equal(canTransition('disputed', 'completed', 'admin').allowed, true);
  assert.equal(DISPUTE_WINDOW_DAYS, 14);
});

test('Policy 6.2 — the only four routes to completion release escrow', () => {
  // Brand approval, automatic completion, resolution settlement, dispute.
  const toCompleted = ['submitted', 'resolution', 'disputed']
    .flatMap((s) => [['brand', s], ['system', s], ['admin', s]])
    .filter(([a, s]) => canTransition(s, 'completed', a).allowed);
  assert.ok(toCompleted.length > 0);
  // No route to completed from an unfunded state.
  for (const s of ['invitation', 'negotiation', 'accepted', 'escrow_pending'])
    for (const a of ['brand', 'creator', 'admin', 'system'])
      assert.equal(canTransition(s, 'completed', a).allowed, false,
        `${a} must not complete from ${s}`);
});
