import { createContext, useContext } from 'react';
import type { SdeMeta } from './sde';

export const SdeContext = createContext<SdeMeta | null>(null);

/** Freshness metadata for the loaded SDE codelists (or null before ready). */
export function useSdeMeta(): SdeMeta | null {
  return useContext(SdeContext);
}
