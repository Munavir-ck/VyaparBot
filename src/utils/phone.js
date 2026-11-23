const INDIAN_MOBILE_10_REGEX = /^[6-9]\d{9}$/;
const INDIAN_MOBILE_11_WITH_ZERO_REGEX = /^0[6-9]\d{9}$/;
const WHATSAPP_E164_DIGITS_REGEX = /^[1-9]\d{10,14}$/;

function invalidPhoneError(message = 'Valid WhatsApp phone number with country code is required') {
  const err = new Error(message);
  err.statusCode = 400;
  err.code = 'INVALID_PHONE_NUMBER';
  return err;
}

/**
 * Normalize a phone number to WhatsApp Cloud API E.164 digits-only format (without '+').
 *
 * - Strips spaces, '+', hyphens, brackets, and other non-digit characters.
 * - 10-digit Indian mobile number ([6-9]xxxxxxxxx) -> prepends '91'.
 * - 11-digit Indian mobile number starting with 0 (0[6-9]xxxxxxxxx) -> strips '0', prepends '91'.
 * - Preserves valid international numbers that already include a country code (11-15 digits, non-zero start).
 * - Rejects null, undefined, empty, ambiguous 10-digit non-Indian-mobile numbers, or invalid E.164 lengths.
 *
 * @param {string|number} rawPhone
 * @returns {string}
 */
export function normalizeWhatsappNumber(rawPhone) {
  if (rawPhone === null || rawPhone === undefined) {
    throw invalidPhoneError();
  }

  const digits = String(rawPhone).replace(/\D/g, '');
  if (!digits) {
    throw invalidPhoneError();
  }

  if (INDIAN_MOBILE_10_REGEX.test(digits)) {
    return `91${digits}`;
  }

  if (INDIAN_MOBILE_11_WITH_ZERO_REGEX.test(digits)) {
    return `91${digits.slice(1)}`;
  }

  if (WHATSAPP_E164_DIGITS_REGEX.test(digits)) {
    return digits;
  }

  throw invalidPhoneError();
}
