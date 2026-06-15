// Centralised formatting helpers enforcing the project number rules:
//   - thousands separator: space
//   - decimal separator: dot
//   - at most 2 decimal places for decimal values

/**
 * Format a number with space thousands separators and a dot decimal
 * separator, trimming trailing zeros, with at most `maxFractionDigits`
 * decimals. No standard locale combines "space + dot", so we build it
 * from the integer/fraction parts directly.
 */
export function formatNumber(value: number, maxFractionDigits = 2): string {
  if (!Number.isFinite(value)) return '—';

  const negative = value < 0;
  const abs = Math.abs(value);
  const factor = 10 ** maxFractionDigits;
  const rounded = Math.round(abs * factor) / factor;

  const [intPart, fracPart] = rounded.toFixed(maxFractionDigits).split('.');
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const trimmedFrac = fracPart ? fracPart.replace(/0+$/, '') : '';

  const body = trimmedFrac ? `${groupedInt}.${trimmedFrac}` : groupedInt;
  return negative ? `-${body}` : body;
}

/** ISK rewards are large; show whole ISK with space grouping. */
export function formatIsk(value: number): string {
  return `${formatNumber(value, 0)} ISK`;
}

/** ISK expressed in millions, e.g. 4 314 445 → "4.31 M ISK". */
export function formatIskMillions(value: number): string {
  return `${formatNumber(value / 1_000_000, 2)} M ISK`;
}

/** Cargo volume in cubic metres. */
export function formatVolume(value: number): string {
  return `${formatNumber(value, 2)} m³`;
}

/**
 * Human-friendly duration from a number of seconds, e.g. "3d 4h" or
 * "12h 5m". Shows the two most significant non-zero units.
 */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 'expired';

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes && parts.length < 2) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push('<1m');

  return parts.slice(0, 2).join(' ');
}
