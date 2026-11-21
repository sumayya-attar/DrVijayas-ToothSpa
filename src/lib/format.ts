export function formatTime12h(hhmm: string): string {
  if (!hhmm || !hhmm.includes(':')) return hhmm;
  const [hRaw, m] = hhmm.split(':').map(Number);
  const period = hRaw >= 12 ? 'PM' : 'AM';
  const h = hRaw % 12 === 0 ? 12 : hRaw % 12;
  return `${h}:${String(m).padStart(2, '0')} ${period}`;
}

export function formatDisplayDate(isoDate: string): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function buildWhatsAppUrl(phone: string, message: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  const formatted = digits.length === 10 ? `91${digits}` : digits || '918310190730';
  return `https://wa.me/${formatted}?text=${encodeURIComponent(message)}`;
}

export function buildTelHref(phone: string): string {
  const cleaned = phone.replace(/[^0-9+]/g, '');
  return `tel:${cleaned || '+918310190730'}`;
}

export function getInitials(name: string): string {
  const words = name
    .replace(/[^a-zA-Z\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'VT';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}
