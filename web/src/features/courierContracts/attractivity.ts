// Attractivity scoring now happens on the server; this module only re-exports
// the factor registry / presets / weights types the weights UI and atoms import.
export {
  FACTORS,
  ATTRACTIVITY_PRESETS,
  DEFAULT_WEIGHTS,
  factorLabel,
} from '@/features/attractivity/scoring';
export type { AttractivityWeights, FactorId, FactorDef } from '@/features/attractivity/scoring';
