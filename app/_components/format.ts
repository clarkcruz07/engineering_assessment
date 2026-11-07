const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** All business dates are UTC; formatting never depends on the viewer's clock or time zone. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'Unknown';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function fmtRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00Z`), e = new Date(`${end}T00:00:00Z`);
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  return `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]}${sameYear ? '' : ` ${s.getUTCFullYear()}`} – ${fmtDate(end)}`;
}
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  return `${fmtDate(iso)}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}
export const fmtInt = (n: number | null | undefined) => n === null || n === undefined ? 'Unknown' : n.toLocaleString('en-US');
export const fmtPct = (n: number | null | undefined) => n === null || n === undefined ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
export const shortHash = (h: string) => h.slice(0, 12);
