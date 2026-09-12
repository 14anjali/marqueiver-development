import { Schema, model } from 'mongoose';

/**
 * One message in a collaboration's thread.
 *
 * ── Attachments are structured now ─────────────────────────────────────────
 *
 * They were `[String]` — bare URLs. Nothing said whether a URL was a photograph
 * or a PDF, and nothing carried the file's name, so every attachment rendered
 * the same way and a creator sending three shots got three identical links.
 * A URL's extension is not a reliable answer either: a signed storage URL
 * usually ends in a query string.
 *
 * So the sender's own `contentType` is stored, and `kind` is derived from it
 * once, here, rather than guessed at each render.
 *
 * ── References ─────────────────────────────────────────────────────────────
 *
 * A message can point at something in the collaboration — a proposal version,
 * the final terms, an accepted amendment. Without it the parties retype the
 * thing they mean ("the deadline in V2"), which is both laborious and the way
 * two people end up discussing different versions without realising.
 *
 * A reference stores what it points at and a label frozen at send time. The
 * label is deliberately a copy: it is what the sender saw, and re-deriving it
 * later would silently rewrite the message when the underlying thing changed.
 */

const IMAGE_TYPES = /^image\//i;

/**
 * Image or file, from the content type.
 *
 * An exported function rather than a `pre('validate')` hook on the subdocument.
 * The hook was written first and did not fire — array subdocument validation
 * did not reach it — so every attachment was stored as `file` and photographs
 * rendered as download chips. A hook that silently does not run is a poor place
 * for something the interface depends on; this is called explicitly where
 * attachments are built, and a test covers it.
 */
export const attachmentKind = (contentType) =>
    (IMAGE_TYPES.test(contentType ?? '') ? 'image' : 'file');

/** One attachment, normalised. The single place `kind` is decided. */
export const toAttachment = (a = {}) => ({
    url: a.url,
    name: a.name ?? '',
    contentType: a.contentType ?? '',
    kind: attachmentKind(a.contentType),
    ...(a.size != null ? { size: a.size } : {}),
});

const attachmentSchema = new Schema({
    url: { type: String, required: true },
    name: { type: String, default: '' },
    contentType: { type: String, default: '' },
    /** Set by `toAttachment` — never inferred from the URL, which is signed. */
    kind: { type: String, enum: ['image', 'file'], default: 'file' },
    size: { type: Number },
}, { _id: false });

export const MESSAGE_REFERENCE_KINDS = ['proposal', 'final_terms', 'amendment', 'change_request'];

const referenceSchema = new Schema({
    kind: { type: String, enum: MESSAGE_REFERENCE_KINDS, required: true },
    /** The id of the referenced thing, where it has one. `final_terms` does not. */
    ref: { type: Schema.Types.ObjectId },
    /** Proposal version number, for `kind: 'proposal'`. */
    seq: { type: Number },
    /** What the sender saw it called. Frozen — see the header. */
    label: { type: String, default: '' },
}, { _id: false });

const messageSchema = new Schema({
    deal: { type: Schema.Types.ObjectId, ref: 'Deal', required: true, index: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, enum: ['creator', 'brand', 'admin'], required: true },

    /**
     * No longer required.
     *
     * It was, so a message could not carry only an image or only a reference —
     * the sender had to type something alongside it, and what people type in
     * that position is "​." or "see above". The validator below requires a
     * message to carry *something*, which is the real rule.
     */
    body: { type: String, default: '' },

    attachments: { type: [attachmentSchema], default: [] },
    references: { type: [referenceSchema], default: [] },

    readBy: { type: [Schema.Types.ObjectId], default: [] },
}, { timestamps: { createdAt: true, updatedAt: false } });

/** A message has to say something, show something, or point at something. */
messageSchema.pre('validate', function requireContent(next) {
    const empty = !this.body?.trim()
        && !(this.attachments?.length)
        && !(this.references?.length);
    next(empty ? new Error('A message needs text, an attachment or a reference') : undefined);
});

messageSchema.index({ deal: 1, createdAt: 1 });

export const Message = model('Message', messageSchema);