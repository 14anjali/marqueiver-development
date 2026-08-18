import { Schema, model } from 'mongoose';

/**
 * Brand ↔ Creator bookmark (feature #21 — Save/bookmark creators).
 * One row per (brand, creator) pair; unique index prevents duplicate saves.
 */
const savedCreatorSchema = new Schema({
    brand: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    creator: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
}, { timestamps: true });

savedCreatorSchema.index({ brand: 1, creator: 1 }, { unique: true });

export const SavedCreator = model('SavedCreator', savedCreatorSchema);
