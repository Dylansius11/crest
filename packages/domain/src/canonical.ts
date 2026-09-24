/**
 * Deterministic JSON for hashing: object keys sorted, arrays kept in order, bigint tagged as `{"$bigint":"…"}`
 * so `1n`, `1`, and `"1"` never collide.
 *
 * Content hashes (policy versions, assessment inputs, idempotency keys) are only reproducible if the same
 * content always produces the same bytes. `JSON.stringify` alone would drop `undefined`, turn `NaN` into
 * `null`, and throw on bigint, so each of those is rejected here instead of silently changing the hash.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`canonicalJson: non-finite number ${value}`);
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return `{"$bigint":"${value.toString()}"}`;
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonicalJson(inner)}`).join(",")}}`;
  }
  throw new Error(`canonicalJson: unsupported ${typeof value}`);
}
