/**
 * Policy 14 (commission), Policy 7 (cancellation), Policy 5.5 (resolution).
 * The worked example in Policy 14.2 is reproduced exactly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCollaborationMoney, computePartialRelease,
  brandCancellationOutcome, creatorCancellationOutcome, currentCommissionPct,
} from '../src/services/commission.service.js';

test('Policy 14.2 worked example reproduces exactly', () => {
  const m = computeCollaborationMoney(10000);
  assert.equal(m.commissionPct, 12.5);
  assert.equal(m.commission, 1250);
  assert.equal(m.creatorNet, 8750);
  assert.equal(m.escrowAmount, 10000);
});

test('Policy 14.5 — the brand is not charged the commission additionally', () => {
  const m = computeCollaborationMoney(10000);
  assert.equal(m.brandPays, 10000, 'brand funds the agreed value and nothing more');
  assert.equal(m.brandPays, m.agreedValue);
});

test('commission + creator net always closes to the agreed value', () => {
  for (const v of [1, 999, 10000, 145000, 33333.33]) {
    const m = computeCollaborationMoney(v);
    assert.ok(Math.abs((m.commission + m.creatorNet) - m.agreedValue) < 0.01,
      `${v} did not close: ${m.commission} + ${m.creatorNet}`);
  }
});

test('Policy 6.6 — no GST until registration', () => {
  const m = computeCollaborationMoney(10000);
  assert.equal(m.gstApplied, false);
  assert.equal(m.gstOnCommission, 0);
});

test('Policy 6.8 — statutory deduction stays 0 pending CA confirmation', () => {
  assert.equal(computeCollaborationMoney(10000).statutoryDeduction, 0);
});

test('Policy 14.7/14.8 — a snapshotted rate overrides the live rate', () => {
  // A promotional 0% deal accepted earlier must not be recomputed at 12.5%.
  const m = computeCollaborationMoney(10000, 0);
  assert.equal(m.commission, 0);
  assert.equal(m.creatorNet, 10000);
  assert.equal(currentCommissionPct(), 12.5, 'live rate is unaffected');
});

test('Policy 7.1 — brand cancellation outcomes by stage', () => {
  const v = 10000;
  assert.equal(brandCancellationOutcome({ state: 'accepted', agreedValue: v }).brandRefund, 10000);
  assert.equal(brandCancellationOutcome({ state: 'accepted', agreedValue: v }).creatorGross, 0);

  const during = brandCancellationOutcome({ state: 'in_progress', agreedValue: v });
  assert.equal(during.creatorGross, 2500, '25% cancellation fee');
  assert.equal(during.brandRefund, 7500, '75% refund');

  const after = brandCancellationOutcome({ state: 'submitted', agreedValue: v });
  assert.equal(after.creatorGross, 10000, 'full fee after submission');
  assert.equal(after.brandRefund, 0, 'no refund after submission');
});

test('Policy 7.2 — creator cannot cancel after submission', () => {
  assert.throws(() => creatorCancellationOutcome({ state: 'submitted', agreedValue: 10000 }));
  const pre = creatorCancellationOutcome({ state: 'in_progress', agreedValue: 10000 });
  assert.equal(pre.brandRefund, 10000, 'full brand refund unless partial work accepted');
});

test('Policy 5.5 option C — 50/50 default settlement', () => {
  const c = computePartialRelease({ agreedValue: 10000, creatorShare: 5000 });
  assert.equal(c.creatorGross, 5000);
  assert.equal(c.brandRefund, 5000);
  assert.equal(c.commission, 625, 'commission on the released half only');
  assert.equal(c.creatorNet, 4375);
});

test('every partial release closes to the escrowed total', () => {
  for (const share of [0, 2500, 5000, 7500, 10000]) {
    const r = computePartialRelease({ agreedValue: 10000, creatorShare: share });
    assert.equal(r.creatorGross + r.brandRefund, 10000);
  }
});
