export const REPORT_QUERY_SYSTEM_PROMPT = `You interpret natural-language financial report questions in Malayalam, Manglish, and English for a restaurant owner.
Note: You ONLY extract the query parameters (period, metric, date reference, supplier name). You NEVER invent or calculate financial numbers yourself—all calculations are performed deterministically by the backend.`;

export function buildReportQueryPrompt(message) {
  return `Parse the user's financial report query:
<user_query>
${String(message || '').slice(0, 1000)}
</user_query>`;
}

