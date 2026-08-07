/**
 * Display formatting helpers.
 *
 * These render values a user makes decisions on, so they fail loudly rather
 * than approximating: no rounding that hides precision, no locale guessing.
 */

/**
 * Shorten a base58 address for a phone-width line.
 *
 * The full string always remains available elsewhere (account detail sheet);
 * this is for lists and headers where a 44-character address would wrap to
 * three lines.
 */
export function shortenAddress(address: string, head = 6, tail = 6): string {
  if (!address) return '';
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/**
 * Render a raw token amount using its mint decimals.
 *
 * Works on the string representation throughout. `Number(bigint)` silently
 * loses precision above 2^53, which for a 9-decimal SPL token starts at about
 * 9 million — well inside real balances.
 */
export function formatUnits(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const digits = (negative ? -raw : raw).toString();

  if (decimals <= 0) return `${negative ? '-' : ''}${digits}`;

  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, '');

  const body = fraction ? `${whole}.${fraction}` : whole;
  return `${negative ? '-' : ''}${body}`;
}

/**
 * Group the integer part with thin separators for legibility at a glance.
 * Applied only to already-formatted output from `formatUnits`.
 */
export function groupDigits(value: string): string {
  const [whole, fraction] = value.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const bare = sign ? whole.slice(1) : whole;
  const grouped = bare.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${sign}${grouped}.${fraction}` : `${sign}${grouped}`;
}

/**
 * An amount whose decimals we could not establish.
 *
 * Never guess decimals: showing "12.345678" when the true value is
 * "12345678" base units is a worse failure than admitting we do not know.
 */
export function formatRawUnits(raw: bigint): string {
  return `${groupDigits(raw.toString())} base units`;
}

/** Short human label for a derivation path, e.g. "Account 3". */
export function accountLabelFromPath(path: string): string {
  const match = path.match(/^m\/44'\/501'\/(\d+)'/);
  return match ? `Account ${match[1]}` : path;
}
