import { env } from '../config/env.js';
/** Media storage abstraction (S3 / Cloudinary / mock). Proposal §8.
 * Returns a presigned-style URL. Mock returns a deterministic placeholder. */
export async function getUploadUrl(key, contentType) {
    if (env.storageProvider === 'mock') {
        return {
            uploadUrl: `https://mock-storage.local/upload/${encodeURIComponent(key)}`,
            publicUrl: `https://mock-storage.local/media/${encodeURIComponent(key)}`,
        };
    }
    // Real S3/Cloudinary presign would go here.
    throw new Error(`Storage provider ${env.storageProvider} not wired in this build`);
}
