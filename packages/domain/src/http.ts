import type { ZodType } from "zod";

import { observe } from "./observation.ts";
import type { Observation, Provenance } from "./observation.ts";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface JsonRequest<T> {
  url: string;
  init?: RequestInit;
  /** The provider contract. Fields Crest consumes are strict; fields it ignores may pass through. */
  schema: ZodType<T>;
  /** Clock injected so fetch time is explicit and testable. */
  now: () => Date;
  /** The provider's documented cache window, when one is documented. */
  cacheSeconds?: number;
  generatedAt?: (body: T) => string | null;
  indexedBlock?: (body: T) => bigint | null;
}

/**
 * Fetches one provider response and returns it as an attributed observation.
 *
 * A transport failure or non-2xx status is `unreadable`; a body that fails the provider contract is
 * `invalid_response`. Neither ever becomes a default value.
 */
export async function readJson<T>(fetchFn: Fetch, request: JsonRequest<T>): Promise<Observation<T>> {
  const fetchedAt = request.now();
  const provenance = (body: T | null): Provenance => ({
    kind: "http",
    url: request.url,
    fetchedAt: fetchedAt.toISOString(),
    generatedAt: body === null ? null : request.generatedAt?.(body) ?? null,
    expiresAt: request.cacheSeconds === undefined ? null : new Date(fetchedAt.getTime() + request.cacheSeconds * 1000).toISOString(),
    indexedBlock: body === null ? null : request.indexedBlock?.(body) ?? null,
  });

  let raw: unknown;
  try {
    const response = await fetchFn(request.url, request.init);
    if (!response.ok) return observe<T>(null, provenance(null), ["unreadable"]);
    raw = await response.json();
  } catch {
    return observe<T>(null, provenance(null), ["unreadable"]);
  }
  const parsed = request.schema.safeParse(raw);
  if (!parsed.success) return observe<T>(null, provenance(null), ["invalid_response"]);
  return observe(parsed.data, provenance(parsed.data));
}
