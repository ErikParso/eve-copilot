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
