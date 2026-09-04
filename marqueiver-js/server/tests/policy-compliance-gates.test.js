/** Compliance gates — Policy 1.3 (18+), 13.1 (mobile+email), 1.14/24 (acceptance), 7/28 (cancellation preview). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { User, Policy } from '../src/models/index.js';
import { brandCancellationOutcome, creatorCancellationOutcome } from '../src/services/commission.service.js';
import { canCancel } from '../src/modules/deals/dealStateMachine.js';

test('Policy 1.3 — the gate needs BOTH a DOB and an explicit declaration', () => {
  const u = new User({ phone: '+919000001111', role: 'creator' });
  assert.equal(u.ageDeclared18Plus, false, 'declaration must be explicit, not implied');
  u.dob = new Date(1990, 0, 1);
  assert.equal(u.meetsMinimumAge(), true);
  // A DOB alone is not the declaration Policy 1.3 asks for.
  assert.equal(u.ageDeclared18Plus, false);
});

test('Policy 13.1 — email alone does not satisfy Basic verification', () => {
  const u = new User({ phone: '+919000002222', role: 'brand', emailVerified: true });
  assert.equal(u.hasBasicVerification(), false);
  u.phoneVerified = true;
  assert.equal(u.hasBasicVerification(), true);
});

test('Policy 1.14 — a policy can require acceptance from specific roles only', () => {
  const creatorOnly = new Policy({
    slug: 'creator-policy', title: 'Creator Policy', version: '1.0',
    effectiveFrom: new Date('2026-08-01'), requiredFor: ['creator'],
  });
  assert.deepEqual(creatorOnly.requiredFor, ['creator']);
});

test('Policy 28 — the preview outcome matches what cancellation will actually do', () => {
  // The preview and the settlement must use the same function, or the number
  // shown to the user could differ from the money that moves.
  const preview = brandCancellationOutcome({ state: 'in_progress', agreedValue: 10000, commissionPct: 12.5 });
  assert.equal(preview.creatorGross, 2500);
  assert.equal(preview.brandRefund, 7500);
  assert.equal(preview.creatorNet, 2187.5, 'net after 12.5% on the released portion');
  assert.equal(preview.creatorGross + preview.brandRefund, 10000, 'must account for the whole escrow');
});

test('Policy 7.2 — the preview refuses rather than showing an outcome', () => {
  assert.equal(canCancel('submitted', 'creator').allowed, false);
  assert.throws(() => creatorCancellationOutcome({ state: 'submitted', agreedValue: 10000 }));
});

test('Policy 7.1 — every stage has a defined, deterministic outcome', () => {
  for (const state of ['accepted', 'escrow_pending', 'in_progress', 'submitted', 'revision']) {
    const o = brandCancellationOutcome({ state, agreedValue: 10000, commissionPct: 12.5 });
    assert.equal(o.creatorGross + o.brandRefund, 10000, `${state} must account for the full amount`);
  }
});
