export function money(paise: number | null) {
  if (paise === null) return 'Not available';
  const whole = BigInt(paise) / 100n;
  const cents = (BigInt(paise) % 100n).toString().padStart(2, '0');
  return `₹${new Intl.NumberFormat('en-IN').format(whole)}.${cents}`;
}
export function calendarDate(value: string | null) {
  return value === null
    ? 'Not available'
    : new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${value}T00:00:00Z`));
}
export function timestamp(value: string) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
