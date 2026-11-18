import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export class WhatsAppMediaService {
  get baseUrl() {
    return env.WHATSAPP_API_BASE_URL;
  }
  get apiVersion() {
    return env.WHATSAPP_API_VERSION;
  }
  get accessToken() {
    return env.WHATSAPP_ACCESS_TOKEN;
  }

  isMockMode() {
    return (
      env.NODE_ENV === 'test' ||
      process.env.MOCK_WHATSAPP === 'true' ||
      !this.accessToken ||
      this.accessToken === 'test_access_token'
    );
  }

  /**
   * Fetch WhatsApp media metadata (download URL, mime type, size)
   * @param {string} mediaId - Meta media ID
   */
  async getMediaMetadata(mediaId) {
    if (this.isMockMode()) {
      logger.info({ mediaId }, '[MOCK] Fetched media metadata');
      return {
        id: mediaId,
        mime_type: 'image/jpeg',
        sha256: 'mock_sha256_hash',
        file_size: 15000,
        url: `https://graph.facebook.com/${this.apiVersion}/${mediaId}/mock_file`,
      };
    }

    try {
      const url = `${this.baseUrl}/${this.apiVersion}/${mediaId}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (!response.ok) {
        logger.error(
          { mediaId, status: response.status },
          'Failed to retrieve WhatsApp media metadata',
        );
        throw new Error('META_MEDIA_METADATA_FAILED');
      }

      return await response.json();
    } catch (err) {
      logger.error({ err: err.message, mediaId }, 'Error in getMediaMetadata');
      throw err;
    }
  }

  /**
   * Download media binary from Meta CDN URL
   * @param {string} mediaUrl - URL obtained from getMediaMetadata
   */
  async downloadMedia(mediaUrl) {
    if (this.isMockMode()) {
      logger.info({ mediaUrl }, '[MOCK] Downloaded media binary');
      // Return a valid minimal 200x200 1x1 JPEG buffer with SOF0 header
      // Valid JPEG header: FF D8 FF E0 ... FF C0 (SOF0: height 200, width 200) ... FF D9
      const minimalValidJpeg = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
        0x00, 0x48, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x00, 0xc8, 0x01, 0x01, 0x11,
        0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07,
        0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14,
        0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23,
        0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38,
        0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
        ...new Array(600).fill(0x55), // pad buffer to exceed MIN_FILE_SIZE_BYTES
        0xff, 0xd9,
      ]);
      return { buffer: minimalValidJpeg, contentType: 'image/jpeg' };
    }

    try {
      const response = await fetch(mediaUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (!response.ok) {
        logger.error({ status: response.status }, 'Failed to download WhatsApp media binary');
        throw new Error('META_MEDIA_DOWNLOAD_FAILED');
      }

      const arrayBuffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      return {
        buffer: Buffer.from(arrayBuffer),
        contentType,
      };
    } catch (err) {
      logger.error({ err: err.message }, 'Error in downloadMedia');
      throw err;
    }
  }

  /**
   * High-level helper: resolve metadata and download media in a single call
   * @param {string} mediaId - Meta media ID
   */
  async downloadWhatsAppMedia(mediaId) {
    logger.info({ mediaId }, 'Downloading WhatsApp media');
    const metadata = await this.getMediaMetadata(mediaId);
    if (!metadata || !metadata.url) {
      throw new Error('META_MEDIA_METADATA_MISSING_URL');
    }

    const { buffer, contentType } = await this.downloadMedia(metadata.url);
    return {
      buffer,
      contentType: metadata.mime_type || contentType,
      mediaId,
    };
  }
}

export const whatsappMediaService = new WhatsAppMediaService();
