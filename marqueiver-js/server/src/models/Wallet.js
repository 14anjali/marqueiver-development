import { Schema, model } from 'mongoose';

/**
 * Internal wallet — the escrow/earnings ledger lives entirely in Marqueiver's
 * own database. `balance` only changes via server-side operations (escrow
 * release credits it, withdrawal debits it); Cashfree is only ever called at
 * the two real-money edges (brand funding an order, creator withdrawing to
 * bank/UPI) — never to represent the wallet balance itself.
 */
const walletSchema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    balance: { type: Number, default: 0, min: 0 },       // INR, withdrawable
    lifetimeCredited: { type: Number, default: 0 },       // running total ever credited (audit/analytics)
    lifetimeWithdrawn: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
}, { timestamps: true });

export const Wallet = model('Wallet', walletSchema);
