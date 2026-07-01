// Zod request schemas for the API. Each schema validates AND infers the
// TypeScript type, replacing the hand-rolled `Number()` / `Number.isFinite`
// parsers in index.ts and the parallel interfaces in types.ts.
//
// `z.coerce.number()` accepts both JSON numbers (request bodies) and numeric
// strings (query params), so one schema covers both transports.
import { z } from 'zod';

/** Non-negative attractivity weight; missing/invalid → fallback 5. */
const weight = z.coerce.number().min(0).catch(5);

/** { income, totalJumps, danger, valueAtRisk }; whole object optional. */
export const attractivityWeightsSchema = z
  .object({
    income: weight,
    totalJumps: weight,
    danger: weight,
    valueAtRisk: weight,
  })
  .default(() => ({ income: 5, totalJumps: 5, danger: 5, valueAtRisk: 5 }));

/** safest | shortest; anything else (or absent) → safest. */
const routeType = z.enum(['safest', 'shortest']).catch('safest');

/** Body of POST /api/arbitrage/sell-destinations. */
export const sellDestinationsSchema = z.object({
  typeId: z.coerce.number().finite(),
  quantity: z.coerce.number().finite().positive(),
  boughtPrice: z.coerce.number().finite(),
  origin: z.coerce.number().finite(),
  routeType,
  taxPct: z.coerce.number().finite().catch(4.5),
  weights: attractivityWeightsSchema,
});

export type SellDestinationsRequest = z.infer<typeof sellDestinationsSchema>;

// --- Pinned-request parsing (lenient: drop invalid entries, keep valid ones) --
// These replace the hand-rolled parse* loops in index.ts. Each element schema
// mirrors the original field-by-field semantics; `lenientArray` reproduces the
// "skip a bad entry, keep the rest" behavior (a malformed pin must never 400 the
// whole hauling request, which also returns the opportunity grid).

/** Keep only array elements that parse; non-arrays → []. */
function lenientArray<S extends z.ZodTypeAny>(schema: S) {
  return z.preprocess(
    (val) => (Array.isArray(val) ? val.filter((v) => schema.safeParse(v).success) : []),
    z.array(schema),
  );
}

/** null | undefined | '' → null; otherwise Number(), non-finite → null. */
const numberOrNull = z.preprocess(
  (v) => (v === null || v === undefined || v === '' ? null : v),
  z.union([z.null(), z.coerce.number().finite()]).catch(null),
);

/** Optional finite number; present-but-invalid → undefined (entry kept). */
const optionalNumber = z.coerce.number().finite().optional().catch(undefined);

/** [Number, …] keeping only finite values; non-array or empty → undefined. */
const finiteNumberArray = z.preprocess((v) => {
  if (!Array.isArray(v)) return undefined;
  const out = v.map(Number).filter(Number.isFinite);
  return out.length ? out : undefined;
}, z.array(z.number()).optional());

const packageStatusLineSchema = z.object({
  typeId: z.coerce.number().finite(),
  quantity: z.coerce.number().finite(),
  // Original: `e.isBlueprintCopy === true` — only literal true is truthy.
  isBlueprintCopy: z.boolean().catch(false),
  hauledQuantity: optionalNumber,
});

/** Body `lines` of the package endpoints. */
export const packageStatusLinesSchema = lenientArray(packageStatusLineSchema);

const pinnedHaulRequestSchema = z.object({
  id: z.string(),
  typeId: z.coerce.number().finite(),
  source: z.coerce.number().finite(),
  dest: z.coerce.number().finite(),
  quantity: z.coerce.number().finite(),
  status: z.enum(['planning', 'transit']),
  // Present-but-invalid boughtPrice drops the whole entry (no `.catch`).
  boughtPrice: z.coerce.number().finite().optional(),
  unitVolume: optionalNumber,
  originalProfit: optionalNumber,
  originalQuantity: optionalNumber,
  originalBuyPrice: optionalNumber,
  knownSourceOrderIds: finiteNumberArray,
  knownDestOrderIds: finiteNumberArray,
});

/** Body `hauls` of POST /api/hauling. */
export const pinnedHaulsRequestSchema = lenientArray(pinnedHaulRequestSchema);

const pinnedPackageRequestSchema = z
  .object({
    id: z.string(),
    contractId: z.coerce.number().finite(),
    status: z.enum(['planning', 'transit']),
    price: z.coerce.number().finite(),
    lines: packageStatusLinesSchema,
    sourceSystem: numberOrNull,
    dest: z.coerce.number().finite(),
    destSystem: numberOrNull,
    originalProfit: optionalNumber,
  })
  // Original skips a package pin with no valid lines.
  .refine((p) => p.lines.length > 0);

/** Body `packages` of POST /api/hauling. */
export const pinnedPackagesRequestSchema = lenientArray(pinnedPackageRequestSchema);
