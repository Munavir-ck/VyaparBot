import crypto from 'crypto';

export const SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MIN_FILE_SIZE_BYTES = 500; // 500 bytes minimum to reject empty/dummy files
export const MIN_IMAGE_DIMENSION = 200; // 200x200 minimum dimension

/**
 * Validate image buffer using magic bytes, dimensions, and size constraints
 * @param {Buffer} buffer - Raw image binary buffer
 * @param {string} [declaredMimeType] - MIME type reported by WhatsApp / HTTP headers
 * @returns {object} { valid: boolean, error?: string, format?: string, mimeType?: string, width?: number, height?: number, hash?: string, size?: number }
 */
export function validateImageBuffer(buffer, declaredMimeType = null) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return { valid: false, error: 'INVALID_BUFFER' };
  }

  const size = buffer.length;
  if (size < MIN_FILE_SIZE_BYTES) {
    return { valid: false, error: 'FILE_TOO_SMALL', size };
  }

  if (size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: 'FILE_TOO_LARGE', size };
  }

  // 1. Magic Bytes Inspection
  // JPEG: FF D8 FF
  const isJpeg =
    buffer.length > 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const isPng =
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;

  // WEBP: RIFF....WEBP
  const isWebp =
    buffer.length > 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP';

  if (!isJpeg && !isPng && !isWebp) {
    return { valid: false, error: 'UNSUPPORTED_FORMAT' };
  }

  let format = 'jpeg';
  let mimeType = 'image/jpeg';
  let width = 0;
  let height = 0;

  try {
    if (isPng) {
      format = 'png';
      mimeType = 'image/png';
      width = buffer.readUInt32BE(16);
      height = buffer.readUInt32BE(20);
    } else if (isWebp) {
      format = 'webp';
      mimeType = 'image/webp';
      const type = buffer.toString('ascii', 12, 16);
      if (type === 'VP8 ') {
        width = buffer.readUInt16LE(26) & 0x3fff;
        height = buffer.readUInt16LE(28) & 0x3fff;
      } else if (type === 'VP8L') {
        const b0 = buffer[21];
        const b1 = buffer[22];
        const b2 = buffer[23];
        const b3 = buffer[24];
        width = 1 + (((b1 & 0x3f) << 8) | b0);
        height = 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      } else {
        // Fallback default valid dimensions
        width = 800;
        height = 800;
      }
    } else if (isJpeg) {
      format = 'jpeg';
      mimeType = 'image/jpeg';
      // Parse SOF0 / SOF2 markers for JPEG dimensions
      let offset = 2;
      while (offset < buffer.length - 8) {
        if (buffer[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = buffer[offset + 1];
        // SOF0 (0xC0) or SOF2 (0xC2) contains height and width
        if (marker === 0xc0 || marker === 0xc2) {
          height = buffer.readUInt16BE(offset + 5);
          width = buffer.readUInt16BE(offset + 7);
          break;
        }
        const length = buffer.readUInt16BE(offset + 2);
        offset += 2 + length;
      }

      // If dimensions couldn't be parsed from markers, assume standard photo dimensions
      if (width === 0 || height === 0) {
        width = 640;
        height = 640;
      }
    }
  } catch {
    return { valid: false, error: 'CORRUPT_IMAGE' };
  }

  // Dimension validation
  if (width > 0 && height > 0 && (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION)) {
    return {
      valid: false,
      error: 'IMAGE_TOO_SMALL',
      width,
      height,
      minRequired: MIN_IMAGE_DIMENSION,
    };
  }

  // Generate SHA-256 hash for duplicate detection
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    valid: true,
    format,
    mimeType,
    width,
    height,
    size,
    hash,
  };
}
