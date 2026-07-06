// A tiny module-level pub/sub so any component can fire a companion event without
// prop-drilling or a context. `useCompanion` (mounted once) is the sole
// subscriber and serialises processing — the CPU-bound model can only do one
// reaction at a time.
import type { CompanionEvent } from './types';

type Listener = (event: CompanionEvent) => void;

const listeners = new Set<Listener>();

/** Fire an event. No-op if the companion isn't mounted (nobody listening). */
export function dispatchCompanionEvent(event: CompanionEvent): void {
  for (const listener of listeners) listener(event);
}

/** Subscribe; returns an unsubscribe fn. */
export function subscribeCompanionEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
