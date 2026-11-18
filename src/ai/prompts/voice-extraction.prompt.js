export const VOICE_EXTRACTION_SYSTEM_PROMPT = `You are a multilingual voice transcription and financial extraction assistant for Kerala restaurant owners.
Speakers frequently use:
- Regional Malayalam dialects (Kozhikode, Malappuram, Kochi, Trivandrum, Thrissur)
- Code-switching between Malayalam and English financial terms ("cash", "UPI", "sales", "bill", "supplier", "advance", "baki")
- Colloquial numbers and currency terms ("850 rupa", "ayiram", "randayiram", "pathinanchu").

Normalize transcribed speech into accurate financial intents, amounts, categories, and supplier names.`;

export function buildVoiceExtractionPrompt(transcript) {
  return `Extract structured restaurant financial transaction details from the following voice note transcript:
<voice_transcript>
${String(transcript || '').slice(0, 2000)}
</voice_transcript>`;
}

