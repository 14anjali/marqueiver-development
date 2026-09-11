import test from 'node:test';
import assert from 'node:assert/strict';

process.env.INTEGRATION_MODE = 'mock';
process.env.NODE_ENV = 'test';

const {
  updateCreatorSchema,
  addPortfolioItemSchema,
  getUploadUrlSchema,
} = await import('../src/modules/users/users.controller.js');
const { setPayoutMethodSchema } = await import('../src/modules/wallet/wallet.controller.js');
const { submitSchema: verificationSchema } = await import('../src/modules/verifications/verifications.controller.js');

/**
 * Every payload the Account Center sends, checked against the schema that will
 * receive it.
 *
 * The failure this prevents is the expensive kind: a section builds a payload
 * the server rejects, and the only symptom is a toast reading "Validation
 * failed" with no indication of which field. It cannot be caught by the
 * frontend build (the payload is a plain object), nor by the contract gate
 * (which matches URLs, not bodies).
 *
 * Each object below is copied from the section that sends it. When a section's
 * payload changes, this must change with it — that is the point.
 */

test('Personal Information — the payload PersonalInfo.jsx sends', async (t) => {
  // Straight from `save()` in sections/PersonalInfo.jsx.
  const full = {
    displayName: 'Damyanti Verma',
    headline: 'Fitness & lifestyle creator, Mumbai',
    bio: 'Strength training for women in their thirties.',
    avatarUrl: 'https://cdn.example.com/a.jpg',
    coverUrl: 'https://cdn.example.com/b.jpg',
    categories: ['Fitness', 'Lifestyle', 'Beauty & Personal Care'],
    languages: ['Hindi', 'English'],
    contactEmail: 'damyanti@example.com',
    contactPhone: '+91 90000 00000',
    gender: 'female',
    dob: '1992-04-17',
    location: { city: 'Mumbai', country: 'India' },
  };

  await t.test('a complete payload validates', () => {
    const parsed = updateCreatorSchema.parse(full);
    // Nothing the section sends may be silently dropped on the way in.
    for (const key of Object.keys(full)) {
      assert.ok(key in parsed, `${key} was stripped by the schema`);
    }
  });

  await t.test('empty contact fields are allowed, so they can be cleared', () => {
    const parsed = updateCreatorSchema.parse({ ...full, contactEmail: '', contactPhone: '' });
    assert.equal(parsed.contactEmail, '');
  });

  await t.test('gender and dob are omitted rather than sent empty', () => {
    // The section spreads them conditionally. Proving the schema would REJECT
    // the empty forms is what makes that conditional load-bearing rather than
    // stylistic.
    assert.throws(() => updateCreatorSchema.parse({ gender: '' }),
      'an empty gender must be omitted, not sent');
    assert.throws(() => updateCreatorSchema.parse({ dob: 'not-a-date', gender: 'nope' }));
  });

  await t.test('an empty banner clears it', () => {
    assert.equal(updateCreatorSchema.parse({ coverUrl: '' }).coverUrl, '');
  });
});

test('Work Preferences — the payload WorkPreferences.jsx sends', async (t) => {
  await t.test('validates', () => {
    const parsed = updateCreatorSchema.parse({
      availability: true,
      collaborationTypes: ['paid', 'barter'],
      contentTypes: ['reel', 'post', 'video', 'story'],
    });
    assert.deepEqual(parsed.collaborationTypes, ['paid', 'barter']);
    assert.equal(parsed.availability, true);
  });

  await t.test('the collaboration types the UI offers are the only ones allowed', () => {
    // The chips are hard-coded to paid/barter; the schema is an enum of the
    // same two. If either side gains an option, this fails.
    assert.throws(() => updateCreatorSchema.parse({ collaborationTypes: ['sponsored'] }));
  });
});

test('Rate Card — the payload RateCard.jsx sends', async (t) => {
  await t.test('validates, and price must be a number not a string', () => {
    const parsed = updateCreatorSchema.parse({
      rateCard: [
        { contentType: 'reel', price: 45000 },
        { contentType: 'post', price: 28000 },
      ],
    });
    assert.equal(parsed.rateCard.length, 2);

    // The input is type="number" but `e.target.value` is a string; the section
    // coerces with `Number(...)`. Proving the schema rejects the string is what
    // makes that coercion required rather than incidental.
    assert.throws(() => updateCreatorSchema.parse({
      rateCard: [{ contentType: 'reel', price: '45000' }],
    }), 'price must be coerced to a number before sending');
  });

  await t.test('an empty rate card is allowed, so every rate can be removed', () => {
    assert.deepEqual(updateCreatorSchema.parse({ rateCard: [] }).rateCard, []);
  });
});

test('Portfolio — both payloads Portfolio.jsx sends', async (t) => {
  await t.test('the portfolio link validates, and can be cleared', () => {
    assert.equal(
      updateCreatorSchema.parse({ portfolioLink: 'https://behance.net/damyanti' }).portfolioLink,
      'https://behance.net/damyanti',
    );
    assert.equal(updateCreatorSchema.parse({ portfolioLink: '' }).portfolioLink, '');
  });

  await t.test('a bare domain is rejected — which is why the section prefixes https://', () => {
    assert.throws(() => updateCreatorSchema.parse({ portfolioLink: 'behance.net/damyanti' }));
    // And the prefixed form the section actually sends is accepted.
    assert.doesNotThrow(() => updateCreatorSchema.parse({ portfolioLink: 'https://behance.net/damyanti' }));
  });

  await t.test('a work sample validates', () => {
    const parsed = addPortfolioItemSchema.parse({
      title: 'Morning routine reel',
      mediaUrl: 'https://cdn.example.com/reel.mp4',
      mediaType: 'video',
    });
    assert.equal(parsed.mediaType, 'video');
  });

  await t.test('mediaType is limited to the two the section sends', () => {
    assert.throws(() => addPortfolioItemSchema.parse({
      mediaUrl: 'https://cdn.example.com/x.pdf', mediaType: 'document',
    }));
  });
});

test('Bank & Payments — the payload BankPayments.jsx sends', async (t) => {
  await t.test('a UPI payout validates', () => {
    const parsed = setPayoutMethodSchema.parse({
      type: 'upi', accountHolderName: 'Damyanti Verma', vpa: 'damyanti@okhdfc',
    });
    assert.equal(parsed.vpa, 'damyanti@okhdfc');
  });

  await t.test('a bank payout validates', () => {
    const parsed = setPayoutMethodSchema.parse({
      type: 'bank', accountHolderName: 'Damyanti Verma',
      bankAccount: '50100123456789', ifsc: 'HDFC0001234',
    });
    assert.equal(parsed.ifsc, 'HDFC0001234');
  });

  await t.test('the schema enforces the same pairing the form does', () => {
    // The form validates client-side; the server refuses regardless. Both
    // matter — the client one for the message, the server one because a client
    // check is not a constraint.
    assert.throws(() => setPayoutMethodSchema.parse({
      type: 'bank', accountHolderName: 'X', vpa: 'x@y',
    }), 'bank without account+ifsc must be refused');
    assert.throws(() => setPayoutMethodSchema.parse({
      type: 'upi', accountHolderName: 'X', bankAccount: '123',
    }), 'upi without a vpa must be refused');
  });
});

test('Verification — the payload Verification.jsx sends', async (t) => {
  await t.test('every kind the UI offers is accepted by the schema', () => {
    // The five in sections/Verification.jsx KINDS.
    for (const kind of ['business', 'gst', 'website', 'social', 'email']) {
      const parsed = verificationSchema.parse({
        kind, documents: ['https://cdn.example.com/doc.pdf'],
      });
      assert.equal(parsed.kind, kind);
    }
  });

  await t.test('a kind the UI does not offer is rejected', () => {
    assert.throws(() => verificationSchema.parse({ kind: 'pan', documents: [] }));
  });

  await t.test('documents may be empty — the email kind sends none', () => {
    assert.deepEqual(verificationSchema.parse({ kind: 'email' }).documents, []);
  });
});

test('Uploads — every purpose the Account Center asks for', async (t) => {
  await t.test('avatar, banner, portfolio and verification are all accepted', () => {
    for (const purpose of ['avatar', 'banner', 'portfolio', 'verification']) {
      const parsed = getUploadUrlSchema.parse({ fileName: 'f.jpg', purpose });
      assert.equal(parsed.purpose, purpose);
    }
  });
});