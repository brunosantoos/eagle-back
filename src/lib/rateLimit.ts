import { TRPCError } from '@trpc/server';

/**
 * Rate limit em memória para os formulários públicos.
 *
 * Suficiente para uma instância única (é como o back roda hoje). Se um dia
 * houver mais de um processo, trocar por Redis mantendo esta interface.
 */

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 10 * 60 * 1000; // 10 min
const MAX_HITS = 5;

/** Remove buckets vazios de vez em quando para não crescer sem limite. */
function prune(now: number) {
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < WINDOW_MS);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

let lastPrune = 0;

/**
 * Conta uma tentativa e lança TOO_MANY_REQUESTS quando passa do limite.
 * `scope` separa formulários diferentes (contato x franquia).
 */
export function enforceRateLimit(
  scope: string,
  identifier: string | undefined,
  { windowMs = WINDOW_MS, max = MAX_HITS } = {},
): void {
  const now = Date.now();
  if (now - lastPrune > windowMs) {
    lastPrune = now;
    prune(now);
  }

  const key = `${scope}:${identifier ?? 'unknown'}`;
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= max) {
    buckets.set(key, bucket);
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Muitos envios em pouco tempo. Tente novamente em alguns minutos.',
    });
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
}
