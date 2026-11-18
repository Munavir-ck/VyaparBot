export const SUPPORTED_AUDIO_MIME_TYPES = [
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/amr',
  'audio/wav',
  'audio/aac',
  'audio/webm',
];

export const MAX_AUDIO_SIZE_BYTES = 16 * 1024 * 1024; // 16MB Meta WhatsApp audio limit
export const MIN_AUDIO_SIZE_BYTES = 4;

/**
 * Validate voice/audio media buffer size and MIME type
 */
export function validateAudioBuffer(buffer, declaredMimeType = 'audio/ogg') {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return { valid: false, error: 'INVALID_AUDIO_BUFFER' };
  }

  const size = buffer.length;
  if (size < MIN_AUDIO_SIZE_BYTES) {
    return { valid: false, error: 'AUDIO_TOO_SMALL', size };
  }
  if (size > MAX_AUDIO_SIZE_BYTES) {
    return { valid: false, error: 'AUDIO_TOO_LARGE', size };
  }

  const baseMime = String(declaredMimeType || 'audio/ogg').split(';')[0].trim().toLowerCase();
  if (!SUPPORTED_AUDIO_MIME_TYPES.includes(baseMime)) {
    return { valid: false, error: 'UNSUPPORTED_AUDIO_MIME', mimeType: baseMime };
  }

  return { valid: true, mimeType: baseMime, size };
}

