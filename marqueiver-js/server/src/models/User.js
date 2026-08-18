import { Schema, model } from 'mongoose';
import bcrypt from 'bcryptjs';
const userSchema = new Schema({
    phone: { type: String, required: true, unique: true, index: true },
    email: { type: String, index: true, sparse: true },
    passwordHash: String,
    role: { type: String, enum: ['creator', 'brand', 'admin'], required: true, index: true },
    adminLevel: { type: String, enum: ['super', 'support', 'finance'] },
    googleId: { type: String, index: true, sparse: true },
    phoneVerified: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    onboardingComplete: { type: Boolean, default: false },
    // Resumable onboarding (feature #4 — save/resume): last step the user reached,
    // so a reload/relogin mid-onboarding continues where they left off instead of
    // restarting. Values are free-form step keys owned by the frontend
    // (e.g. 'details', 'instagram' for creators; 'company', 'logo' for brands).
    onboardingStep: { type: String, default: '' },
    lastSyncedAt: Date,
    status: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
}, { timestamps: true });
userSchema.methods.setPassword = async function (pw) {
    this.passwordHash = await bcrypt.hash(pw, 10);
};
userSchema.methods.checkPassword = async function (pw) {
    if (!this.passwordHash)
        return false;
    return bcrypt.compare(pw, this.passwordHash);
};
export const User = model('User', userSchema);
