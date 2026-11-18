import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export class S3StorageProvider {
  constructor(config = {}) {
    this.bucket = config.bucket || env.STORAGE_BUCKET || 'restaurant-receipts-media';
    this.region = config.region || env.STORAGE_REGION || 'ap-south-1';
    this.endpoint = config.endpoint || env.STORAGE_ENDPOINT || undefined;
    this.accessKey = config.accessKey || env.STORAGE_ACCESS_KEY || '';
    this.secretKey = config.secretKey || env.STORAGE_SECRET_KEY || '';

    // Determine mock / offline mode
    this.isMock =
      env.NODE_ENV === 'test' ||
      !this.accessKey ||
      this.accessKey === 'test_access_key' ||
      !this.secretKey ||
      this.secretKey === 'test_secret_key';

    if (!this.isMock) {
      this.client = new S3Client({
        region: this.region,
        endpoint: this.endpoint,
        credentials: {
          accessKeyId: this.accessKey,
          secretAccessKey: this.secretKey,
        },
      });
    } else {
      this.mockStorage = new Map();
    }
  }

  /**
   * Upload an object to S3 / Object Storage
   */
  async upload({ key, buffer, contentType = 'image/jpeg' }) {
    if (this.isMock) {
      logger.info(
        { key, size: buffer.length, contentType },
        '[MOCK STORAGE] Uploaded object to mock storage',
      );
      this.mockStorage.set(key, { buffer, contentType, uploadedAt: new Date() });
      return {
        key,
        bucket: this.bucket,
        size: buffer.length,
        contentType,
        url: `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`,
      };
    }

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      });

      await this.client.send(command);

      logger.info(
        { key, size: buffer.length, contentType },
        'Object successfully uploaded to S3',
      );

      return {
        key,
        bucket: this.bucket,
        size: buffer.length,
        contentType,
      };
    } catch (err) {
      logger.error(
        { err: err.message, key, bucket: this.bucket },
        'Failed to upload object to S3',
      );
      throw new Error('STORAGE_UPLOAD_FAILED');
    }
  }

  /**
   * Delete an object from S3
   */
  async delete(key) {
    if (this.isMock) {
      logger.info({ key }, '[MOCK STORAGE] Deleted object from mock storage');
      this.mockStorage.delete(key);
      return { success: true, key };
    }

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(command);
      return { success: true, key };
    } catch (err) {
      logger.error({ err: err.message, key }, 'Failed to delete object from S3');
      throw new Error('STORAGE_DELETE_FAILED');
    }
  }

  /**
   * Generate a secure presigned GET URL for viewing private photo
   */
  async getSignedUrl(key, expiresIn = 3600) {
    if (this.isMock) {
      return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}?mock_signature=valid&expires=${Date.now() + expiresIn * 1000}`;
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      return await getSignedUrl(this.client, command, { expiresIn });
    } catch (err) {
      logger.error({ err: err.message, key }, 'Failed to generate signed S3 URL');
      throw new Error('STORAGE_SIGNED_URL_FAILED');
    }
  }
}
