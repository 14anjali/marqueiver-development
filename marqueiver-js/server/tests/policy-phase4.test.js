/** Phase 4 — Policy 5.3 review window, 5.4 revisions, 5.5 resolution, 11 late, 15 disclosure. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { Deal } from '../src/models/index.js';
import { canRequestRevision, REVIEW_WINDOW_DAYS, RESOLUTION_AUTO_DAYS } from '../src/modules/deals/dealStateMachine.js';
import { computePartialRelease } from '../src/services/commission.service.js';

const base = () => ({ brand: new Types.ObjectId(), creator: new Types.ObjectId(), title: 't', terms: { amount: 10000 } });

test('Policy 5.3 — the review window is 7 days', () => {
  assert.equal(REVIEW_WINDOW_DAYS, 7);
});

test('Policy 5.5 — option C applies automatically after 7 days', () => {
  assert.equal(RESOLUTION_AUTO_DAYS, 7);
});

test('Policy 5.4 — a third revision request is refused', () => {
  const d = { terms: { revisionsAllowed: 2 }, revisionCount: 2 };
  const r = canRequestRevision(d);
  assert.equal(r.allowed, false);
  assert.equal(r.limit, 2);
  assert.equal(r.used, 2);
});

test('Policy 15 — disclosure fields exist and default to unconfirmed', () => {
  const d = new Deal(base());
  assert.equal(d.disclosure?.confirmedAt, undefined, 'submission must be blocked until confirmed');
  const methods = Deal.schema.path('disclosure.method').enumValues;
  for (const m of ['#ad', '#sponsored', '#paidpartnership'])
    assert.ok(methods.includes(m), `${m} missing`);
});

test('Policy 11 — a submission can be marked late', () => {
  const d = new Deal(base());
  d.workSubmissions.push({ urls: ['x'], submittedAt: new Date(), late: true });
  assert.equal(d.workSubmissions[0].late, true);
});

test('Policy 5.3 — reminder tracking prevents duplicate sends', () => {
  const d = new Deal(base());
  assert.deepEqual(d.reviewRemindersSent, []);
});

test('Policy 5.5 option C — 50/50 with commission on the released half only', () => {
  const c = computePartialRelease({ agreedValue: 10000, commissionPct: 12.5, creatorShare: 5000 });
  assert.equal(c.creatorGross, 5000);
  assert.equal(c.brandRefund, 5000);
  assert.equal(c.commission, 625);
  assert.equal(c.creatorNet, 4375);
});

test('Policy 24 — the cancellation record captures the stage it happened at', () => {
  const d = new Deal(base());
  d.cancellation = { stage: 'in_progress', byRole: 'brand', reason: 'x', at: new Date() };
  assert.equal(d.cancellation.stage, 'in_progress');
});

test('Policy 5.3/5.5 — a system transition works without a human actor', async () => {
  // `new Types.ObjectId(null)` threw, so every automatic completion crashed.
  const { Deal } = await import('../src/models/index.js');
  const d = new Deal({ ...base(), state: 'submitted' });
  d.timeline.push({ from: 'submitted', to: 'completed', by: undefined, byRole: 'system', at: new Date() });
  await d.validate();
  assert.equal(d.timeline.at(-1).byRole, 'system');
});

test('Policy 14.7/14.8 — the deal carries a commission snapshot field', () => {
  const d = new Deal({ ...base() });
  assert.ok(Deal.schema.path('commission.ratePct'), 'rate must be snapshottable');
  assert.ok(Deal.schema.path('commission.snapshotAt'));
  assert.equal(d.commission?.ratePct, undefined, 'unset until Acceptance');
});

test('Policy 5.2/24 — the deal records the governing policy version', () => {
  assert.ok(Deal.schema.path('policyVersionAtAcceptance'));
});
