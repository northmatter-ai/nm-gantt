/** Deterministic hashing of the normalised schedule input (no crypto dependency). */

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Two independent 32-bit FNV-1a lanes → 16 hex characters. */
function fnv64(text: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000197) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function hashInput(input: {
  activities: { id: string }[];
  links: { id: string }[];
  calendars: { id: string }[];
  [k: string]: unknown;
}): string {
  const normalised = {
    ...input,
    activities: [...input.activities].sort(byId),
    links: [...input.links].sort(byId),
    calendars: [...input.calendars].sort(byId),
  };
  return fnv64(stableStringify(normalised));
}
