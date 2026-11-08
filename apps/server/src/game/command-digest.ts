import { createHash } from 'node:crypto';
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  return v;
}
export function commandDigest(event: string, payload: unknown) {
  return createHash('sha256')
    .update(JSON.stringify({ event, payload: canonical(payload) }))
    .digest('hex');
}
