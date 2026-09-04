import { connectDb, disconnectDb } from '../config/db.js';
import { User, CreatorProfile, BrandProfile, Deal, Campaign, } from '../models/index.js';
import { fetchSocialStats } from '../services/meta.service.js';
import { logger } from '../config/logger.js';
/**
 * Sample data mirroring the frontend screens (Damyanti Verma, Rohit Sharma, Nike…).
 * Runs automatically on first boot; `npm run seed` forces a reseed.
 */
const CREATORS = [
    { name: 'Damyanti Verma', headline: 'Fitness & Lifestyle Creator', city: 'Delhi',
        cats: ['Fitness', 'Lifestyle', 'Wellness'], gender: 'female',
        socials: ['instagram', 'youtube', 'linkedin', 'tiktok', 'x'], rate: 45000 },
    { name: 'Rohit Sharma', headline: 'Tech & Productivity Creator', city: 'Bangalore',
        cats: ['Tech', 'Productivity'], gender: 'male',
        socials: ['instagram', 'youtube', 'linkedin', 'x'], rate: 60000 },
    { name: 'Ananya Singh', headline: 'Fashion & Beauty Creator', city: 'Mumbai',
        cats: ['Fashion', 'Beauty', 'Lifestyle'], gender: 'female',
        socials: ['instagram', 'youtube', 'tiktok', 'pinterest'], rate: 55000 },
    { name: 'Vikram Kapoor', headline: 'Travel Creator', city: 'Goa',
        cats: ['Travel', 'Adventure'], gender: 'male',
        socials: ['instagram', 'youtube', 'facebook', 'tiktok'], rate: 70000 },
    { name: 'Neha Patel', headline: 'Yoga & Wellness Creator', city: 'Pune',
        cats: ['Wellness', 'Health'], gender: 'female',
        socials: ['instagram', 'youtube', 'tiktok', 'pinterest'], rate: 35000 },
    { name: 'Arjun Mehta', headline: 'Finance & Investing Creator', city: 'Delhi',
        cats: ['Finance', 'Education'], gender: 'male',
        socials: ['youtube', 'linkedin', 'instagram', 'x'], rate: 65000 },
];
const BRANDS = [
    { name: 'Nike', industry: 'Sportswear', size: '10,001+', about: "World's leading innovator in athletic footwear, apparel and equipment." },
    { name: 'Mamaearth', industry: 'Beauty & Personal Care', size: '1,001-5,000', about: 'Toxin-free, natural personal care.' },
    { name: 'boAt Lifestyle', industry: 'Audio & Electronics', size: '501-1,000', about: 'Affordable lifestyle audio and wearables.' },
];
async function seed() {
    let i = 0;
    for (const c of CREATORS) {
        i += 1;
        const phone = `+9190000001${String(i).padStart(2, '0')}`;
        const user = await User.create({ phone, role: 'creator', phoneVerified: true, onboardingComplete: true });
        const socials = await Promise.all(c.socials.map((p) => fetchSocialStats(p, c.name.replace(/\s/g, '').toLowerCase())));
        await CreatorProfile.create({
            user: user._id, displayName: c.name, headline: c.headline,
            bio: `${c.headline}. I create content around ${c.cats.join(', ').toLowerCase()}.`,
            categories: c.cats, languages: ['English', 'Hindi'], gender: c.gender,
            location: { city: c.city, country: 'India' },
            socialAccounts: socials,
            rateCard: [
                { contentType: 'reel', price: c.rate },
                { contentType: 'post', price: Math.round(c.rate * 0.6) },
                { contentType: 'story', price: Math.round(c.rate * 0.3) },
            ],
            contentTypes: ['reel', 'post', 'story', 'video'],
            availability: true, creatorScore: 90 + (i % 10), responseTimeHrs: 24,
        });
    }
    const brandUsers = [];
    let j = 0;
    for (const b of BRANDS) {
        j += 1;
        const phone = `+9190000002${String(j).padStart(2, '0')}`;
        const user = await User.create({ phone, role: 'brand', phoneVerified: true, onboardingComplete: true });
        brandUsers.push(user);
        await BrandProfile.create({
            user: user._id, companyName: b.name, industry: b.industry, companySize: b.size,
            about: b.about, foundedYear: 1972, location: { city: 'Global', country: 'India' },
            verifications: { business: true, gst: true, website: true, social: true, email: true },
            trust: { paymentReliability: 4.9, communication: 4.8, campaignExperience: 4.9,
                repeatCollaboration: 4.8, overall: 4.9, reviewCount: 128 },
            paymentSuccessRate: 99, avgResponseTimeHrs: 2,
            teamMembers: [{ name: 'Priya Nair', role: 'Marketing Director' }],
        });
    }
    // A sample open campaign (deferred-scope model foundation, proposal §12).
    await Campaign.create({
        brand: brandUsers[0]._id, title: 'Fitness Reels Campaign', brief: 'UGC reels for a new fitness line.',
        contentTypes: ['reel'], budget: 45000, location: 'India', tags: ['Reels', 'Fitness'],
        deadline: new Date(Date.now() + 4 * 864e5),
    });
    // A demo deal in negotiation between Nike and Damyanti.
    const nike = brandUsers[0];
    const damyanti = await User.findOne({ phone: '+919000000101' });
    if (damyanti) {
        await Deal.create({
            brand: nike._id, creator: damyanti._id, origin: 'invite',
            title: 'Fitness Reels Campaign', contentTypes: ['reel'],
            terms: { amount: 45000, deliverables: '3 reels + 2 stories', revisionsAllowed: 1 },
            state: 'negotiation', // Policy 5.1 vocabulary
            timeline: [
                { from: null, to: 'requested', by: nike._id, byRole: 'brand', at: new Date() },
                { from: 'requested', to: 'negotiating', by: damyanti._id, byRole: 'creator', at: new Date() },
            ],
        });
    }
    logger.info(`🌱 Seeded ${CREATORS.length} creators, ${BRANDS.length} brands, 1 campaign, 1 demo deal`);
}
/** Called at boot — only seeds when the DB is empty. */
/**
 * Policy 24 — the platform cannot record which version a user accepted unless
 * the versions exist.
 *
 * These rows are the **real** Marqueiver Platform Policies effective 01 August
 * 2026, imported from the authoritative document (see
 * `modules/policies/policyCatalog.js`). The previous revision of this file
 * seeded titles with an empty `body`, which meant every policy page rendered a
 * "text available on request" notice and a user was asked to accept a document
 * they could not read. That is fixed at the source: the full text now ships with
 * the server.
 *
 * The rows are upserted on every boot rather than only when the collection is
 * empty, because a deployment carrying new policy text has to publish it.
 * Existing PolicyAcceptance rows are untouched and stay valid for the version
 * they name — acceptances are append-only (Policy 24), so republishing never
 * rewrites what anyone agreed to. Publishing a *new* version deliberately leaves
 * users outstanding against it, which is what drives the 1.14 re-consent prompt.
 */
export async function seedPolicies() {
    const { Policy } = await import('../models/index.js');
    const { POLICY_V2 } = await import('../modules/policies/policyCatalog.js');

    for (const p of POLICY_V2) {
        await Policy.updateOne(
            { slug: p.slug, version: p.version },
            {
                $set: {
                    slug: p.slug,
                    title: p.title,
                    version: p.version,
                    number: p.number,
                    effectiveFrom: new Date(p.effectiveFrom),
                    requiredFor: p.requiredFor,
                    body: p.body,
                    intro: p.intro,
                    sections: p.sections,
                    route: p.route ?? undefined,
                    signupPrimary: Boolean(p.signupPrimary),
                    documentUrl: p.route ?? `/policies/${p.slug}`,
                },
            },
            { upsert: true },
        );
    }
    logger.info(`📜 Published ${POLICY_V2.length} policies at v${POLICY_V2[0]?.version}`);
}

export async function seedIfEmpty() {
    const count = await User.countDocuments({ role: { $in: ['creator', 'brand'] } });
    if (count === 0)
        await seed();
    else
        logger.info(`(seed skipped — ${count} users already present)`);
}
// Standalone `npm run seed` — wipes and reseeds.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        await connectDb();
        await Promise.all([
            User.deleteMany({ role: { $in: ['creator', 'brand'] } }),
            CreatorProfile.deleteMany({}), BrandProfile.deleteMany({}),
            Deal.deleteMany({}), Campaign.deleteMany({}),
        ]);
        await seed();
        await disconnectDb();
        process.exit(0);
    })();
}
