import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.INTEGRATION_MODE = 'mock';
process.env.NODE_ENV = 'test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');
const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8');

const { BrandProfile } = await import('../src/models/index.js');
const { updateBrandSchema } = await import('../src/modules/users/users.controller.js');
const {
    brandVerificationLevel, isBusinessDomain, emailDomain,
} = await import('../src/services/verificationLevel.service.js');

/**
 * The Brand Account Center's fields, contracts and privacy boundary.
 *
 * Mongoose runs in strict mode, so a path missing from the schema is dropped on
 * write with no error — a field can look correct in the UI, validate happily at
 * the API boundary, and then simply not save. Both halves are asserted here for
 * every field the new sections write.
 */

test('BrandProfile declares every field the Account Center writes', async (t) => {
    const paths = [
        'coverUrl', 'tagline', 'categories', 'businessType', 'gstin',
        'billing.legalName', 'billing.addressLine1', 'billing.city',
        'billing.state', 'billing.postalCode', 'billing.country',
        'campaignPreferences.creatorCategories',
        'campaignPreferences.contentTypes',
        'campaignPreferences.collaborationTypes',
        'campaignPreferences.targetAudience',
    ];

    for (const p of paths) {
        await t.test(`${p} exists`, () => {
            assert.ok(BrandProfile.schema.path(p),
                `${p} must be declared or strict mode discards it on save`);
        });
    }

    await t.test('the pre-existing fields are untouched', () => {
        // Nothing was removed to make room for the new ones.
        // `trust` and `verifications` are plain nested objects, not
        // subdocuments, so `schema.path()` resolves only their leaves — the
        // parent name returns undefined even though the field is present.
        for (const p of ['companyName', 'industry', 'companySize', 'foundedYear',
            'about', 'website', 'logo', 'contactPerson', 'contactEmail',
            'contactPhone', 'socialAccounts', 'teamMembers',
            'trust.overall', 'trust.paymentReliability',
            'verifications.business', 'verifications.gst', 'verifications.website',
            'verifications.social', 'verifications.email']) {
            assert.ok(BrandProfile.schema.path(p), `${p} must not have been removed`);
        }
    });
});

test('updateBrandSchema accepts what each section sends', async (t) => {
    await t.test('Business Information', () => {
        const parsed = updateBrandSchema.parse({
            companyName: 'Mamaearth', businessType: 'Private limited company',
            industry: 'Beauty & Personal Care',
            categories: ['Beauty & Personal Care', 'Lifestyle'],
            companySize: '201–500', foundedYear: 2016,
            about: 'Toxin-free personal care.', website: 'https://mamaearth.in',
            contactPerson: 'Priya', contactEmail: 'priya@mamaearth.in',
            contactPhone: '+91 90000 00000', gstin: '27AAPFU0939F1ZV',
            location: { city: 'Gurugram', country: 'India' },
        });
        assert.equal(parsed.gstin, '27AAPFU0939F1ZV');
        assert.deepEqual(parsed.categories, ['Beauty & Personal Care', 'Lifestyle']);
    });

    await t.test('Brand Identity', () => {
        const parsed = updateBrandSchema.parse({
            logo: 'https://cdn.example.com/logo.png',
            coverUrl: 'https://cdn.example.com/banner.jpg',
            tagline: 'Clean skincare, made in India',
            about: 'Toxin-free personal care.',
        });
        assert.equal(parsed.coverUrl, 'https://cdn.example.com/banner.jpg');
        assert.equal(parsed.tagline, 'Clean skincare, made in India');
    });

    await t.test('Campaign Preferences', () => {
        const parsed = updateBrandSchema.parse({
            campaignPreferences: {
                creatorCategories: ['Beauty & Personal Care'],
                contentTypes: ['reel', 'post'],
                collaborationTypes: ['paid', 'barter'],
                targetAudience: 'Women 24–35 in metros.',
            },
        });
        assert.deepEqual(parsed.campaignPreferences.collaborationTypes, ['paid', 'barter']);
    });

    await t.test('Payment & Billing', () => {
        const parsed = updateBrandSchema.parse({
            billing: {
                legalName: 'Honasa Consumer Limited', addressLine1: '4th Floor',
                city: 'Gurugram', state: 'Haryana', postalCode: '122002', country: 'India',
            },
            gstin: '27AAPFU0939F1ZV',
        });
        assert.equal(parsed.billing.city, 'Gurugram');
    });

    await t.test('a malformed GSTIN is rejected, and an empty one clears it', () => {
        assert.throws(() => updateBrandSchema.parse({ gstin: '27AAPFU' }),
            'a 7-character GSTIN must not save');
        assert.throws(() => updateBrandSchema.parse({ gstin: 'not-a-gstin-at-all' }));
        assert.equal(updateBrandSchema.parse({ gstin: '' }).gstin, '');
    });

    await t.test('an empty contact email is allowed, so it can be cleared', () => {
        assert.equal(updateBrandSchema.parse({ contactEmail: '' }).contactEmail, '');
    });

    await t.test('a collaboration type the UI does not offer is rejected', () => {
        assert.throws(() => updateBrandSchema.parse({
            campaignPreferences: { collaborationTypes: ['sponsored'] },
        }));
    });
});

/* ───────────────────────── Policy 13.1 verification level ────────────────── */

test('brandVerificationLevel follows Policy 13.1', async (t) => {
    const verifiedUser = { phoneVerified: true, emailVerified: true };

    await t.test('nothing verified is "none"', () => {
        const r = brandVerificationLevel({ companyName: 'X' }, {});
        assert.equal(r.level, 'none');
        assert.equal(r.brandVerified, false);
    });

    await t.test('mobile and email alone is Basic', () => {
        const r = brandVerificationLevel({ companyName: 'X' }, verifiedUser);
        assert.equal(r.level, 'basic');
    });

    await t.test('the full brand requirement set is Brand verified', () => {
        const r = brandVerificationLevel({
            companyName: 'Mamaearth',
            contactEmail: 'priya@mamaearth.in',
            website: 'https://mamaearth.in',
            verifications: { business: true, email: true, website: true },
        }, verifiedUser);

        assert.equal(r.level, 'brand_verified');
        assert.equal(r.brandVerified, true);
        assert.deepEqual(r.outstanding, []);
    });

    await t.test('a consumer mailbox does not satisfy the work-email requirement', () => {
        const r = brandVerificationLevel({
            companyName: 'Mamaearth',
            // Policy 13.1: "work email on a business domain".
            contactEmail: 'someone@gmail.com',
            website: 'https://mamaearth.in',
            verifications: { business: true, email: true, website: true },
        }, verifiedUser);

        assert.equal(r.brandVerified, false);
        assert.ok(r.outstanding.some((o) => o.id === 'workEmail'));
    });

    await t.test('GSTIN is conditional, not required', () => {
        // "GSTIN where applicable" — a brand without one is still verifiable.
        const r = brandVerificationLevel({
            companyName: 'X', contactEmail: 'a@x.co', website: 'https://x.co',
            verifications: { business: true, email: true, website: true },
        }, verifiedUser);
        assert.equal(r.brandVerified, true);
        assert.equal(r.gstOnRecord, false);
    });

    await t.test('every outstanding item names the section that fixes it', () => {
        const r = brandVerificationLevel({}, {});
        assert.ok(r.outstanding.length > 0);
        for (const o of r.outstanding) {
            assert.ok(o.section, `${o.id} must name a section`);
            assert.ok(o.label, `${o.id} must have a label`);
        }
    });

    await t.test('the level cannot be granted by the caller', () => {
        // A profile claiming to be verified is ignored; only the real inputs count.
        const r = brandVerificationLevel(
            { companyName: 'X', verificationLevel: { level: 'enhanced', brandVerified: true } },
            {},
        );
        assert.equal(r.level, 'none');
    });
});

test('business-domain detection', async (t) => {
    await t.test('consumer mailboxes are not business domains', () => {
        for (const e of ['a@gmail.com', 'a@yahoo.co.in', 'a@outlook.com', 'a@rediffmail.com']) {
            assert.equal(isBusinessDomain(e), false, e);
        }
    });
    await t.test('an own domain is', () => {
        assert.equal(isBusinessDomain('priya@mamaearth.in'), true);
    });
    await t.test('a missing or malformed address is not', () => {
        assert.equal(isBusinessDomain(''), false);
        assert.equal(isBusinessDomain(undefined), false);
        assert.equal(isBusinessDomain('no-at-sign'), false);
    });
    await t.test('the domain is extracted case-insensitively', () => {
        assert.equal(emailDomain('Priya@MamaEarth.IN'), 'mamaearth.in');
    });
});

/* ────────────────────────────── privacy boundary ─────────────────────────── */

test('a creator never receives a brand\'s private business data', async (t) => {
    const source = read('modules/discovery/discovery.controller.js');

    const match = source.match(/const PRIVATE_BRAND_FIELDS\s*=\s*'([^']+)'/);
    assert.ok(match, 'PRIVATE_BRAND_FIELDS must exist');
    const excluded = match[1].split(/\s+/).filter(Boolean);

    await t.test('tax and invoicing identifiers are excluded', () => {
        for (const f of ['-gstin', '-billing']) {
            assert.ok(excluded.includes(f), `${f} must never reach a creator`);
        }
    });

    await t.test('direct contact details are excluded', () => {
        // Policy 4.2 — contacting a creator outside the platform to avoid fees.
        // The same reasoning applies to handing out the brand's direct line.
        for (const f of ['-contactEmail', '-contactPhone', '-contactPerson', '-teamMembers']) {
            assert.ok(excluded.includes(f), `${f} must never reach a creator`);
        }
    });

    await t.test('every entry is an exclusion', () => {
        // One field without its minus turns the whole projection into an
        // inclusion, and the exclusions stop applying.
        for (const f of excluded) assert.ok(f.startsWith('-'), `${f} must start with "-"`);
    });

    await t.test('both brand reads apply the projection', () => {
        const calls = [...source.matchAll(/BrandProfile\.(find|findById|findOne)\(/g)];
        assert.ok(calls.length >= 2, 'expected the directory and the single-brand read');

        const offenders = [];
        for (const call of calls) {
            const after = source.slice(call.index, call.index + 240);
            if (!after.includes('PRIVATE_BRAND_FIELDS')) {
                offenders.push(source.slice(0, call.index).split('\n').length);
            }
        }
        assert.deepEqual(offenders, [],
            `BrandProfile read(s) at line(s) ${offenders.join(', ')} return the whole document`);
    });

    await t.test('the public brand profile exposes a level, never documents', () => {
        const fn = source.slice(source.indexOf('export const getBrandProfile'));
        const body = fn.slice(0, fn.indexOf('});'));

        assert.ok(body.includes('verificationLevel'), 'the badge is what a creator gets');

        /*
          Comments stripped first. The initial version of this check matched the
          word "documents" inside the explanatory comment directly above the
          handler — the assertion failed on prose describing the very rule it
          was verifying, which is a test reading its own documentation.
        */
        const code = body
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');

        assert.ok(!/\bdocuments\b/.test(code),
            'Policy 13.5 — verification documents are never returned to other users');

        // And the level it does return carries no document references.
        assert.ok(/level\.level|level\.label|brandVerified/.test(code),
            'only the derived level fields are forwarded');
    });
});

/* ─────────────────── the deleted-brand cleanup that never ran ─────────────── */

test('deleting a brand account clears its public identity', async (t) => {
    const source = read('modules/users/users.controller.js');
    const fn = source.slice(source.indexOf('export const deleteAccount ='));
    const brandBlock = fn.slice(fn.indexOf('BrandProfile.findOneAndUpdate'), fn.indexOf('BrandProfile.findOneAndUpdate') + 700);

    await t.test('the logo is cleared using the real field name', () => {
        // It wrote `logoUrl`, which is not a path on BrandProfile, so strict
        // mode dropped it and a deleted brand's logo stayed live on every
        // campaign it had ever run.
        assert.ok(/\blogo\s*:/.test(brandBlock), 'must clear `logo`');
        assert.ok(!/logoUrl/.test(brandBlock), '`logoUrl` is not a field on this model');
    });

    await t.test('the private business data is cleared too', () => {
        assert.ok(/gstin/.test(brandBlock), 'a deleted account must not keep its GSTIN');
        assert.ok(/billing/.test(brandBlock), 'nor its invoicing address');
    });
});