/** Phases 1–3: age/verification (1.3, 13.1), policy versioning (24, 1.14), money records (6.3, 6.8, 14, 24). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { User, Policy, PolicyAcceptance, Payout, CommissionRecord } from '../src/models/index.js';

test('Policy 1.3 — under-18 fails the age check', () => {
  const under = new User({ phone: '+919000000001', role: 'creator' });
  under.dob = new Date(new Date().getFullYear() - 17, 0, 1);
  assert.equal(under.meetsMinimumAge(), false);

  const over = new User({ phone: '+919000000002', role: 'creator' });
  over.dob = new Date(new Date().getFullYear() - 25, 0, 1);
  assert.equal(over.meetsMinimumAge(), true);

  const unknown = new User({ phone: '+919000000003', role: 'creator' });
  assert.equal(unknown.meetsMinimumAge(), false, 'no DOB must not pass');
});

test('Policy 13.1 — Basic verification needs BOTH mobile and email', () => {
  const u = new User({ phone: '+919000000004', role: 'creator', phoneVerified: true });
  assert.equal(u.hasBasicVerification(), false, 'phone alone is not enough');
  u.emailVerified = true;
  assert.equal(u.hasBasicVerification(), true);
});

test('Policy 12 — enforcement ladder exists on the user', () => {
  const u = new User({ phone: '+919000000005', role: 'creator' });
  assert.equal(u.accountStatus, 'active');
  assert.equal(u.enforcementLevel, 'none');
  const levels = User.schema.path('enforcementLevel').enumValues;
  for (const l of ['warning', 'restriction', 'suspension', 'termination'])
    assert.ok(levels.includes(l), `${l} missing from the ladder`);
});

test('Policy 1.14 — a policy can be published before it takes effect', () => {
  const future = new Policy({
    slug: 'terms-of-use', title: 'Terms', version: '2.0',
    effectiveFrom: new Date(Date.now() + 7 * 864e5), materialChange: true,
  });
  assert.ok(future.effectiveFrom > new Date(), 'supports the 7-day notice window');
  assert.equal(future.materialChange, true);
});

test('Policy 24 — acceptances are immutable', async () => {
  await assert.rejects(
    () => PolicyAcceptance.updateOne({ _id: new Types.ObjectId() }, { version: '9.9' }),
    /immutable/,
  );
});

test('Policy 24 — commission records are immutable after creation', async () => {
  const rec = new CommissionRecord({
    deal: new Types.ObjectId(), creator: new Types.ObjectId(), brand: new Types.ObjectId(),
    agreedValue: 10000, ratePct: 12.5, amount: 1250, chargedOn: 10000,
    releaseReason: 'brand_approval',
  });
  rec.isNew = false;
  await assert.rejects(() => rec.save(), /immutable/);
});

test('payout arithmetic must close', async () => {
  const bad = new Payout({
    deal: new Types.ObjectId(), creator: new Types.ObjectId(),
    grossAmount: 10000, commission: 1250, netAmount: 9000, payoutMethod: 'upi',
  });
  await assert.rejects(() => bad.validate(), /does not balance/);

  const good = new Payout({
    deal: new Types.ObjectId(), creator: new Types.ObjectId(),
    grossAmount: 10000, commission: 1250, netAmount: 8750, payoutMethod: 'upi',
  });
  await good.validate();
  assert.equal(good.netAmount, 8750, 'matches the Policy 14.2 example');
});

test('Policy 6.8 — TDS fields exist but assume nothing', () => {
  const p = new Payout({
    deal: new Types.ObjectId(), creator: new Types.ObjectId(),
    grossAmount: 10000, commission: 1250, netAmount: 8750, payoutMethod: 'upi',
  });
  assert.equal(p.tdsAmount, 0, 'no deduction assumed');
  assert.equal(p.tdsRatePct, null, 'no rate invented pending CA confirmation');
  assert.equal(p.tdsSection, null);
});

test('Policy 24 — payout amounts cannot be edited after creation', async () => {
  const p = new Payout({
    deal: new Types.ObjectId(), creator: new Types.ObjectId(),
    grossAmount: 10000, commission: 1250, netAmount: 8750, payoutMethod: 'upi',
  });
  p.isNew = false;
  p.grossAmount = 20000;
  await assert.rejects(() => p.save(), /immutable/);
});
