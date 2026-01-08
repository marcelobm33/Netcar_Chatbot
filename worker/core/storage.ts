
import type { Env } from '../types';

/**
 * Storage Service - Manages image uploads to Cloudflare R2
 */

export class StorageService {
    private bucket: R2Bucket;

    constructor(bucket: R2Bucket) {
        this.bucket = bucket;
    }

    /**
     * Upload an image to R2
     * @param key Unique filename
     * @param data File content (Stream, Buffer, or String)
     * @param contentType MIME type
     */
    async uploadImage(key: string, data: any, contentType: string): Promise<string> {
        console.log(`[STORAGE] Uploading ${key} (${contentType})...`);
        
        await this.bucket.put(key, data, {
            httpMetadata: {
                contentType: contentType,
            },
            customMetadata: {
                uploadedAt: new Date().toISOString()
            }
        });

        // Return the simple key, full URL will be constructed by the API
        return key;
    }

    /**
     * Get an image from R2
     * @param key Filename
     */
    async getImage(key: string): Promise<R2ObjectBody | null> {
        const object = await this.bucket.get(key);
        return object;
    }

    /**
     * Delete an image
     */
    async deleteImage(key: string): Promise<void> {
        await this.bucket.delete(key);
    }
}
