/** Account deletion, visibility (3.3), age declaration (1.3), metric provenance (3.2/13.2). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { CreatorProfile, User } from '../src/models/index.js';

test('Policy 3.3 — profiles are published by default and can be unpublished', () => {
  const p = new CreatorProfile({ user: new Types.ObjectId(), displayName: 'A' });
  assert.equal(p.isPublished, true);
  p.isPublished = false;
  p.unpublishedAt = new Date();
  assert.equal(p.isPublished, false);
});

test('Policy 3.2/13.2 — self-reported metrics are stored apart from verified ones', () => {
  const p = new CreatorProfile({ user: new Types.ObjectId(), displayName: 'A' });
  p.selfReportedMetrics = { followers: 50000, declaredAt: new Date() };
  p.socialAccounts.push({ platform: 'instagram', handle: 'x', followers: 12000, dataSource: 'connected' });

  // The two must never be summed or merged — that is what would present a
  // declared figure as verified.
  assert.equal(p.selfReportedMetrics.followers, 50000);
  assert.equal(p.socialAccounts[0].followers, 12000);
  assert.equal(p.socialAccounts[0].dataSource, 'connected');
  assert.ok(!('followers' in p.toObject()), 'no merged top-level follower count');
});

test('Policy 1.3 — the age declaration is a separate flag from the DOB', () => {
  const u = new User({ phone: '+919000003333', role: 'creator', dob: new Date(1995, 0, 1) });
  assert.equal(u.meetsMinimumAge(), true);
  assert.equal(u.ageDeclared18Plus, false, 'DOB alone is not the declaration');
});

test('account deletion fields exist for anonymised retention', () => {
  assert.ok(User.schema.path('deletedAt'));
  assert.ok(User.schema.path('deletionReason'));
  const levels = User.schema.path('accountStatus').enumValues;
  assert.ok(levels.includes('terminated'));
});

test('Policy 3.3 — cover image is a real field, not a frontend-only prop', () => {
  assert.ok(CreatorProfile.schema.path('coverUrl'));
});
