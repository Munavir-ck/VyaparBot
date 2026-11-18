export function formatCurrency(amount: number = 0, currency: string = 'INR'): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${Math.round(amount || 0).toLocaleString('en-IN')}`;
}

export function formatDate(dateInput: string | Date, timezone: string = 'Asia/Kolkata'): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: timezone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(dateInput));
  } catch {
    return String(dateInput);
  }
}

export function formatLabel(value: string): string {
  return String(value || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

