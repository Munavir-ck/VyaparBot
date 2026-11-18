import crypto from 'crypto';
import { S3StorageProvider } from './s3.storage.js';

class StorageService {
  constructor(provider = null) {
    this.provider = provider || new S3StorageProvider();
  }

  /**
   * Check if storage provider is configured with real credentials
   */
  isConfigured() {
    return !this.provider.isMock;
  }

  /**
   * Generate secure, random storage key: receipts/<userId>/<uuid>.<ext>
   */
  generateKey(userId, ext = 'jpg') {
    const cleanUserId = String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '');
    const uniqueId = crypto.randomUUID();
    const cleanExt = ext.replace(/^\./, '').toLowerCase();
    return `receipts/${cleanUserId}/${uniqueId}.${cleanExt}`;
  }

  /**
   * Upload user photo
   * @param {object} params
   * @param {string} params.userId
   * @param {Buffer} params.buffer
   * @param {string} [params.contentType]
   * @param {string} [params.ext]
   */
  async uploadPhoto({ userId, buffer, contentType = 'image/jpeg', ext = 'jpg' }) {
    const key = this.generateKey(userId, ext);
    const result = await this.provider.upload({
      key,
      buffer,
      contentType,
    });

    return {
      storageKey: key,
      size: buffer.length,
      contentType,
      ...result,
    };
  }

  /**
   * Delete a stored photo
   * @param {string} key - Storage key
   */
  async deletePhoto(key) {
    if (!key) return false;
    return this.provider.delete(key);
  }

  /**
   * Generate temporary presigned viewing URL
   * @param {string} key - Storage key
   * @param {number} [expiresIn=3600] - Expiry in seconds
   */
  async getSignedPhotoUrl(key, expiresIn = 3600) {
    if (!key) return null;
    return this.provider.getSignedUrl(key, expiresIn);
  }
}

export const storageService = new StorageService();
