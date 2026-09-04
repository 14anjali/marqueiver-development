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
