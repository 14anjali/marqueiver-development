import { Schema, model } from 'mongoose';
const socialSchema = new Schema({
    platform: String, handle: String, followers: Number,
    engagementRate: Number, verified: Boolean,
    dataSource: { type: String, default: 'self_reported' },
}, { _id: false });
const brandSchema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    companyName: { type: String, required: true, index: 'text' },
    industry: { type: String, default: '', index: true },
    companySize: { type: String, default: '' },
    foundedYear: Number,
    about: { type: String, default: '' },
    website: String,
    logo: String,                 // SRS FR-3.3 — company logo URL

    /**
     * Cover/banner image for the brand's public profile.
     *
     * The creator profile has `coverUrl` for the same purpose, so the name
     * matches rather than inventing `bannerUrl` for the identical concept.
     */
    coverUrl: { type: String, default: '' },

    /** One line under the name — the brand equivalent of a creator headline. */
    tagline: { type: String, default: '' },

    /**
     * Business categories, plural.
     *
     * `industry` above is a single string and stays exactly as it is — it is
     * indexed and existing code filters on it. Brands rarely sit in one
     * category though, and creators already have a `categories` array, so this
     * mirrors that shape. `industry` remains the primary//legacy value.
     */
    categories: { type: [String], default: [], index: true },

    /** Sole proprietorship, private limited, agency, and so on. Free text. */
    businessType: { type: String, default: '' },

    /**
     * GSTIN — Policy 4.1: brands "must provide accurate company details, and
     * GSTIN where applicable, for invoicing", and Policy 13.1 lists it as part
     * of Brand verification.
     *
     * PRIVATE. It is a tax identifier tied to a legal entity, it is used for
     * invoicing and verification only, and creators have no reason to see it.
     * `discovery.controller.js` strips it, in the same way it strips a
     * creator's payout details.
     */
    gstin: { type: String, default: '' },

    /**
     * Invoicing details. PRIVATE, for the same reason as GSTIN.
     *
     * Deliberately NOT a payment instrument: brands fund escrow through
     * Cashfree at the point of payment, and no card or bank detail is stored
     * here. This is only the legal name and address that belongs on an invoice.
     */
    billing: {
        legalName: { type: String, default: '' },
        addressLine1: { type: String, default: '' },
        addressLine2: { type: String, default: '' },
        city: { type: String, default: '' },
        state: { type: String, default: '' },
        postalCode: { type: String, default: '' },
        country: { type: String, default: 'India' },
    },

    /**
     * What this brand is looking for, so creators can judge fit before applying.
     *
     * Descriptive only. Nothing here constrains or validates a real campaign —
     * Policy V2 defines no such rule, and campaign creation, briefs and
     * negotiation are untouched by these values. They exist to be read.
     */
    campaignPreferences: {
        creatorCategories: { type: [String], default: [] },
        contentTypes: { type: [String], default: [] },
        collaborationTypes: { type: [String], default: [] },
        targetAudience: { type: String, default: '' },
    },
    contactPerson: String,        // SRS FR-3.1
    contactEmail: String,
    contactPhone: String,
    location: { city: String, country: { type: String, default: 'India' } },
    socialAccounts: { type: [socialSchema], default: [] },
    trust: {
        paymentReliability: { type: Number, default: 0 },
        communication: { type: Number, default: 0 },
        campaignExperience: { type: Number, default: 0 },
        repeatCollaboration: { type: Number, default: 0 },
        overall: { type: Number, default: 0 },
        reviewCount: { type: Number, default: 0 },
    },
    verifications: {
        business: { type: Boolean, default: false },
        gst: { type: Boolean, default: false },
        website: { type: Boolean, default: false },
        social: { type: Boolean, default: false },
        email: { type: Boolean, default: false },
    },
    teamMembers: { type: [{ name: String, role: String, _id: false }], default: [] },
    paymentSuccessRate: { type: Number, default: 0 },
    avgResponseTimeHrs: { type: Number, default: 24 },
}, { timestamps: true });
export const BrandProfile = model('BrandProfile', brandSchema);