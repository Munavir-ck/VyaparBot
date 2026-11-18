/**
 * Automatic Multilingual & Code-Switching Detection Service
 * Detects Malayalam script ('ml'), Manglish ('manglish'), English ('en'), or Mixed ('mixed')
 * without requiring users to pre-select a language.
 */

const MALAYALAM_UNICODE_REGEX = /[\u0D00-\u0D7F]/;

// Common Manglish financial & conversational tokens used in Kerala restaurants
const MANGLISH_TOKENS = new Set([
  'innu',
  'innathe',
  'innale',
  'rupa',
  'roopa',
  'pachakkari',
  'pachakari',
  'kari',
  'meen',
  'irachi',
  'koli',
  'kozhi',
  'vangichu',
  'vangi',
  'vangiyathu',
  'koduthu',
  'koduthathu',
  'kitti',
  'kittiyathu',
  'ethra',
  'ethrayanu',
  'aanu',
  'anu',
  'und',
  'undu',
  'baki',
  'baaki',
  'kanakku',
  'kanakk',
  'kooli',
  'vadaka',
  'kassu',
  'kaashu',
  'vilpana',
  'kച്ചവടം',
  'kachavadam',
  ' ചിലവ്',
  'chilavu',
  'chelavu',
  'motham',
  'total',
  'ravile',
  'uchakku',
  'vaikunneram',
  'rathri',
  'kadam',
  'pattu',
  'theerthu',
  'adachu',
  'venda',
  'sheri',
  'athe',
  'alla',
  'maattu',
  'kalayu',
]);

// Common Manglish suffixes / patterns
const MANGLISH_PATTERNS = [
  /\b(innu|innathe|innale)\b/i,
  /\b(vangichu|vangiyathu|vangi|koduthu|koduthathu)\b/i,
  /\b(rupa|roopa)\b/i,
  /\b(pachakkari|pachakari|irachi|meen|kozhi|palacharakku)\b/i,
  /\b(ethra|ethrayanu|aanu|anu|und|undu)\b/i,
  /\b(chilavu|chelavu|kachavadam|vilpana|kanakku|baaki|baki|kadam)\b/i,
  /\b(ravile|uchakku|vaikunneram|rathri)\b/i,
];

const ENGLISH_CORE_WORDS = new Set([
  'today',
  'todays',
  'yesterday',
  'bought',
  'paid',
  'sales',
  'sale',
  'expense',
  'expenses',
  'vegetables',
  'meat',
  'fish',
  'groceries',
  'gas',
  'electricity',
  'wages',
  'salary',
  'rent',
  'maintenance',
  'transport',
  'cash',
  'upi',
  'report',
  'monthly',
  'daily',
  'supplier',
  'balance',
  'purchase',
  'purchased',
  'credit',
  'delete',
  'edit',
  'cancel',
  'confirm',
  'yes',
  'no',
]);

class LanguageDetectionService {
  /**
   * Detect the primary language style of a user message:
   * - 'ml'       : Contains Malayalam Unicode script
   * - 'manglish' : Malayalam written in Latin script (or mixed Manglish + English terms)
   * - 'en'       : Standard English
   * - 'mixed'    : Malayalam script combined with Latin script or heavy code-switching
   */
  detectLanguage(text = '') {
    const clean = String(text || '').trim();
    if (!clean) return 'en';

    const hasMalayalamScript = MALAYALAM_UNICODE_REGEX.test(clean);
    const hasLatinChars = /[a-zA-Z]{2,}/.test(clean);

    if (hasMalayalamScript) {
      // Even if there are numbers or 'UPI'/'Cash', if Malayalam script dominates, treat as 'ml'
      const malayalamChars = (clean.match(/[\u0D00-\u0D7F]/g) || []).length;
      const latinChars = (clean.match(/[a-zA-Z]/g) || []).length;
      if (latinChars > malayalamChars && latinChars > 6) {
        return 'mixed';
      }
      return 'ml';
    }

    if (!hasLatinChars) {
      return 'en';
    }

    const words = clean
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    let manglishCount = 0;
    let englishCount = 0;

    for (const w of words) {
      if (MANGLISH_TOKENS.has(w)) {
        manglishCount++;
      } else if (ENGLISH_CORE_WORDS.has(w)) {
        englishCount++;
      }
    }

    for (const pattern of MANGLISH_PATTERNS) {
      if (pattern.test(clean)) {
        manglishCount++;
      }
    }

    if (manglishCount > 0) {
      return 'manglish';
    }

    return 'en';
  }

  /**
   * Determine response language style ('ml', 'manglish', 'en')
   */
  getResponseStyle(detectedLanguage, userPreference = 'auto') {
    if (userPreference && userPreference !== 'auto') {
      return userPreference;
    }
    if (detectedLanguage === 'ml') return 'ml';
    if (detectedLanguage === 'manglish' || detectedLanguage === 'mixed') return 'manglish';
    return 'en';
  }
}

export const languageDetectionService = new LanguageDetectionService();

