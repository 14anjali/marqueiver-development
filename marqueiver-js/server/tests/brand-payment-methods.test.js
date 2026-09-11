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
/** Comments describe the rules; they must never be what satisfies an assertion. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const { BrandPaymentMethod, BRAND_PAYMENT_METHOD_TYPES } = await import('../src/models/index.js');
const {
    brandPaymentMethodSchema, brandPaymentMethodPatchSchema,
} = await import('../src/modules/payments/payments.controller.js');

/**
 * Brand payment methods — reference records, never chargeable instruments.
 *
 * What these tests are for, stated plainly: they prove the *storage contract*
 * and the *authorization shape*, by asserting against the real zod schemas, the
 * real mongoose schema, and the controller source. They do not run a request
 * against a database — no MongoDB is reachable in this environment — so they
 * cannot prove a round trip persists. What they can prove is that nothing here
 * is able to accept a card, able to store a whole account number, or able to
 * read another brand's row, because each of those is refused by a schema or by
 * a query filter that is checked below.
 */

test('a card can never be stored', () => {
    // Not "is not currently offered" — structurally impossible. Accepting a PAN
    // would put this application in PCI-DSS scope, which is exactly what
    // Cashfree's hosted checkout exists to avoid.
    assert.deepEqual(BRAND_PAYMENT_METHOD_TYPES, ['bank', 'upi', 'netbanking']);
    assert.equal(BRAND_PAYMENT_METHOD_TYPES.includes('card'), false);

    const enumValues = BrandPaymentMethod.schema.path('type').enumValues;
    assert.equal(enumValues.includes('card'), false);

    for (const forbidden of ['cardNumber', 'pan', 'cvv', 'expiry', 'expiryMonth', 'token']) {
        assert.equal(
            BrandPaymentMethod.schema.path(forbidden), undefined,
            `BrandPaymentMethod must not declare "${forbidden}"`,
        );
    }

    assert.equal(brandPaymentMethodSchema.safeParse({ type: 'card', vpa: 'a@b' }).success, false);
});

test('the model stores four digits, never a full account number', () => {
    assert.ok(BrandPaymentMethod.schema.path('accountLast4'), 'accountLast4 must exist');
    assert.equal(
        BrandPaymentMethod.schema.path('accountNumber'), undefined,
        'a full account number must have nowhere to be stored',
    );

    const doc = new BrandPaymentMethod({
        brand: '000000000000000000000001',
        type: 'bank',
        accountLast4: '123456',      // too long for the path's match
    });
    const err = doc.validateSync();
    assert.ok(err?.errors?.accountLast4, 'accountLast4 must reject more than four digits');
});

test('the controller truncates the account number before it reaches mongoose', () => {
    const src = code('modules/payments/payments.controller.js');

    // The payload field exists (so a brand types the number it knows) …
    assert.match(src, /accountNumber:/);
    // … and the only thing derived from it is the last four digits.
    assert.match(src, /accountLast4 = last4\(body\.accountNumber\)/);
    // `toDocument` is what builds the document, and it never assigns the raw value.
    const toDocument = src.slice(src.indexOf('function toDocument'), src.indexOf('const brandOnly'));
    assert.equal(
        /accountNumber:\s*body\.accountNumber/.test(toDocument), false,
        'toDocument must not copy the raw account number onto the document',
    );
    assert.match(/^\s*const last4 =/m.test(src) ? 'ok' : '', /ok/);
});

test('last4 keeps exactly the final four digits', async () => {
    // Re-derived rather than imported, because `last4` is module-private; this
    // asserts the rule the controller states, and the source check above
    // asserts the controller still uses it.
    const last4 = (value) => String(value ?? '').replace(/\D/g, '').slice(-4);
    assert.equal(last4('000123456789'), '6789');
    assert.equal(last4('1234 5678 9012'), '9012'); // spaces stripped
    assert.equal(last4(''), '');
    assert.equal(last4(undefined), '');
});

test('validation: a bank method needs an account number and IFSC', () => {
    const bad = brandPaymentMethodSchema.safeParse({ type: 'bank', bankName: 'HDFC' });
    assert.equal(bad.success, false);

    const good = brandPaymentMethodSchema.safeParse({
        type: 'bank', accountNumber: '000123456789', ifsc: 'HDFC0001234',
    });
    assert.equal(good.success, true, JSON.stringify(good.error?.flatten()));
    assert.equal(good.data.ifsc, 'HDFC0001234');

    assert.equal(
        brandPaymentMethodSchema.safeParse({
            type: 'bank', accountNumber: '000123456789', ifsc: 'NOTANIFSC1',
        }).success,
        false,
        'a malformed IFSC must be refused',
    );
    assert.equal(
        brandPaymentMethodSchema.safeParse({
            type: 'bank', accountNumber: '12ab', ifsc: 'HDFC0001234',
        }).success,
        false,
        'a non-numeric account number must be refused',
    );
});

test('validation: a UPI method needs a VPA and no bank fields', () => {
    assert.equal(brandPaymentMethodSchema.safeParse({ type: 'upi' }).success, false);

    const good = brandPaymentMethodSchema.safeParse({ type: 'upi', vpa: 'Brand@OKHDFCBank' });
    assert.equal(good.success, true, JSON.stringify(good.error?.flatten()));
    assert.equal(good.data.vpa, 'brand@okhdfcbank', 'a VPA is normalised to lower case');

    assert.equal(
        brandPaymentMethodSchema.safeParse({ type: 'upi', vpa: 'not a vpa' }).success, false,
    );
});

test('the patch schema accepts a single field', () => {
    const one = brandPaymentMethodPatchSchema.safeParse({ label: 'Marketing account' });
    assert.equal(one.success, true, 'a PATCH must not require the whole object');
    // …but still refuses nonsense on the fields it is given.
    assert.equal(brandPaymentMethodPatchSchema.safeParse({ ifsc: 'nope' }).success, false);
});

test('every handler scopes its query to the calling brand', () => {
    const src = code('modules/payments/payments.controller.js');
    const section = src.slice(src.indexOf('const brandOnly'));

    // Ownership is part of the filter, never a check made after loading a row
    // by id — that difference is what stops one brand reading another's.
    for (const call of [
        /BrandPaymentMethod\.find\(\{ brand: req\.auth\.sub \}\)/,
        /BrandPaymentMethod\.findOne\(\{ _id: req\.params\.id, brand: req\.auth\.sub \}\)/,
        /BrandPaymentMethod\.findOneAndUpdate\(\s*\{ _id: req\.params\.id, brand: req\.auth\.sub \}/,
        /BrandPaymentMethod\.findOneAndDelete\(\{ _id: req\.params\.id, brand: req\.auth\.sub \}\)/,
        /BrandPaymentMethod\.exists\(\{ _id: req\.params\.id, brand: req\.auth\.sub \}\)/,
    ]) {
        assert.match(section, call);
    }

    // No handler may address a row by id alone.
    assert.equal(
        /BrandPaymentMethod\.findById\(/.test(section), false,
        'findById cannot express ownership — use findOne with a brand filter',
    );
});

test('only brands reach these endpoints, at both layers', () => {
    const routes = code('modules/payments/payments.routes.js');
    const lines = routes.split('\n').filter((l) => l.includes("'/methods"));
    assert.equal(lines.length, 5, 'five method routes: list, add, update, default, remove');
    for (const line of lines) {
        assert.match(line, /authenticate/, line);
        assert.match(line, /requireRole\('brand'\)/, line);
    }

    // And again in the handler, so a route wired without the guard still fails.
    const src = code('modules/payments/payments.controller.js');
    assert.match(src, /const brandOnly = \(req\) => \{[\s\S]*?role !== 'brand'[\s\S]*?forbidden/);
    const handlers = [
        'listBrandPaymentMethods', 'addBrandPaymentMethod', 'updateBrandPaymentMethod',
        'setDefaultBrandPaymentMethod', 'removeBrandPaymentMethod',
    ];
    for (const h of handlers) {
        const start = src.indexOf(`export const ${h} =`);
        assert.ok(start > -1, `${h} must exist`);
        const body = src.slice(start, start + 400);
        assert.match(body, /brandOnly\(req\)/, `${h} must call brandOnly`);
    }
});

test('exactly one default: cleared before one is set', () => {
    const src = code('modules/payments/payments.controller.js');
    const setDefault = src.slice(
        src.indexOf('export const setDefaultBrandPaymentMethod'),
        src.indexOf('export const removeBrandPaymentMethod'),
    );
    const clearAt = setDefault.indexOf('updateMany({ brand: req.auth.sub }, { isDefault: false })');
    const setAt = setDefault.indexOf('{ isDefault: true }');
    assert.ok(clearAt > -1 && setAt > -1, 'both halves must be present');
    assert.ok(clearAt < setAt, 'clear must come before set, so a crash leaves none rather than two');
});

test('nothing in the escrow path consults a payment method', () => {
    // The point of the whole feature: these rows are records, and the money
    // path must not have quietly started depending on them.
    for (const rel of [
        'services/cashfree.service.js',
        'modules/deals/deals.service.js',
        'modules/deals/deals.controller.js',
        'modules/deals/additionalTerms.service.js',
    ]) {
        assert.equal(
            code(rel).includes('BrandPaymentMethod'), false,
            `${rel} must not read BrandPaymentMethod — escrow funding is unchanged`,
        );
    }
});

test('no creator-facing endpoint can read the collection', () => {
    for (const rel of [
        'modules/discovery/discovery.controller.js',
        'modules/campaigns/campaigns.controller.js',
        'modules/users/users.controller.js',
    ]) {
        assert.equal(
            code(rel).includes('BrandPaymentMethod'), false,
            `${rel} must not read BrandPaymentMethod`,
        );
    }
});

test('status starts unverified and nothing claims otherwise', () => {
    const statusPath = BrandPaymentMethod.schema.path('status');
    assert.deepEqual(statusPath.enumValues, ['unverified', 'verified', 'rejected']);
    assert.equal(statusPath.defaultValue, 'unverified');

    // No handler writes `status` — there is no penny-drop check and no review
    // queue, so a row must never come back marked verified on its own.
    const src = code('modules/payments/payments.controller.js');
    const section = src.slice(src.indexOf('const brandOnly'));
    assert.equal(
        /status:\s*'verified'/.test(section), false,
        'nothing may set a payment method to verified until a real check exists',
    );
});

test('a new brand’s first method becomes its default', () => {
    const src = code('modules/payments/payments.controller.js');
    const add = src.slice(
        src.indexOf('export const addBrandPaymentMethod'),
        src.indexOf('export const updateBrandPaymentMethod'),
    );
    assert.match(add, /existing === 0/, 'the first row must default itself');
    assert.match(add, /existing >= 10/, 'and the list must be bounded');
});