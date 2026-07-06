// AI companion — shared types. The companion reacts to what the pilot does with a
// single spoken line. Character development (memory, self-summary, reflection) is
// intentionally out for now — this is the minimal action→response pipe.

/** The events the companion reacts to. Only `app-load` and `eve-action` are wired
 * in the prototype; the rest are declared so the taxonomy is stable as we add
 * them. Two eventual classes: intent (pilot did something → always responds) and
 * ambient (`items-updated` → may stay silent). */
export type CompanionEventType =
  | 'app-load'
  | 'items-updated'
  | 'opportunity-pinned'
  | 'stage-changed'
  | 'rerouted'
  | 'eve-action';

export type EveAction = 'set-waypoint' | 'open-market' | 'open-contract';

/** A discriminated union of every event shape. Grows as we wire more events. */
export type CompanionEvent =
  | { type: 'app-load' }
  | { type: 'eve-action'; action: EveAction; target: string };

/** A line shown in the panel — the companion's response to an event. */
export interface CompanionMessage {
  id: string;
  ts: string;
  eventType: CompanionEventType;
  text: string;
}
