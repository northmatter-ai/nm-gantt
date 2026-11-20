/**
 * Fractional indexing for sibling order: keys are strings over a base-62 alphabet that
 * sort by plain string comparison, and a key can always be generated between two others.
 * Keys never end in the smallest digit, so there is always room below.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0]!;

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // Shared prefix (treating a missing digit in `a` as zero).
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]!) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (db - da > 1) return DIGITS[Math.floor((da + db) / 2)]!;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[da]! + midpoint(a.slice(1), null);
}

/** A key strictly between a and b (null = open end). */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) throw new Error(`keyBetween: ${a} is not below ${b}`);
  return midpoint(a ?? '', b);
}

/** n increasing keys after `after`. */
export function keysAfter(after: string | null, n: number): string[] {
  const out: string[] = [];
  let k = after;
  for (let i = 0; i < n; i++) { k = keyBetween(k, null); out.push(k); }
  return out;
}

/** n evenly spaced increasing keys of minimal width, for bulk creation (imports, generators). */
export function evenKeys(n: number): string[] {
  if (n <= 0) return [];
  let width = 1;
  while (62 ** width < n + 2) width++;
  const space = 62 ** width;
  const step = Math.floor(space / (n + 1));
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    let v = i * step;
    let s = '';
    for (let w = 0; w < width; w++) { s = DIGITS[v % 62]! + s; v = Math.floor(v / 62); }
    out.push(s.replace(/0+$/, ''));
  }
  return out;
}
