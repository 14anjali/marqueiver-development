import { Schema, model } from 'mongoose';

/**
 * An audit record of a Meta "Data Deletion Request" (and of a Deauthorize
 * callback, which is recorded the same way with `kind: 'deauthorize'`).
 *
 * Meta's contract requires the data-deletion endpoint to answer with a
 * confirmation code and a URL the person can open to check the status of their
 * request. That means the code has to outlive the request itself, which is the
 * whole reason this collection exists — and it is also the record we would show
 * a regulator asking whether a deletion request was actually honoured.
 *
 * What is deliberately NOT stored here:
 *  - the `signed_request` itself, or any token from it. It is a bearer-ish
 *    credential; keeping it would turn an audit log into a secret store.
 *  - the person's name, email, handle or profile. Deleting somebody's data and
 *    then retaining a copy of it in the deletion record would defeat the point.
 *
 * `providerUserId` is kept because without it the record cannot be matched to
 * the request Meta made, and because it is an opaque app-scoped id rather than
 * a personal identifier — it is meaningless outside this app.
 */
const dataDeletionRequestSchema = new Schema(
    {
        kind: {
            type: String,
            enum: ['data_deletion', 'deauthorize'],
            required: true,
            index: true,
        },
        platform: {
            type: String,
            enum: ['facebook', 'instagram'],
            required: true,
            index: true,
        },

        /** Meta's app-scoped user id from the signed_request payload. */
        providerUserId: { type: String, required: true, index: true },

        /**
         * The Marqueiver account the connection belonged to, when one matched.
         * Nullable on purpose: Meta will happily send a deletion request for a
         * person who never connected here, or who already disconnected, and
         * that is a successful no-op rather than an error.
         */
        user: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },

        /**
         * The code quoted back to Meta and shown to the person. Unique because
         * it is the lookup key for the public status page; sparse because
         * deauthorize records do not get one (Meta asks for no response body).
         */
        confirmationCode: { type: String, unique: true, sparse: true, index: true },

        status: {
            type: String,
            enum: ['received', 'completed', 'no_data_found', 'failed'],
            default: 'received',
            index: true,
        },

        /**
         * Counts only — how much was removed, never what it was.
         */
        removed: {
            instagramAccounts: { type: Number, default: 0 },
            facebookPages: { type: Number, default: 0 },
            socialProfileEntries: { type: Number, default: 0 },
        },

        /** Internal only. Never returned by the public status endpoint. */
        failureReason: { type: String },

        requestedAt: { type: Date, default: Date.now },
        completedAt: { type: Date },
    },
    { timestamps: true },
);

export const DataDeletionRequest = model('DataDeletionRequest', dataDeletionRequestSchema);
