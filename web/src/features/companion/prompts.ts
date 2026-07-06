// Prompt assembly. Minimal for now: a fixed identity + few-shot examples, then the
// current event. No memory/personality — that comes back later. The few-shot
// examples are what keep the tiny CPU model from echoing prompt fragments.
import type { CompanionEvent } from './types';

const BASE_IDENTITY = `You are the onboard assistant AI for an EVE Online capsuleer, embedded in their hauling and market tool.
You react to what the pilot does with ONE natural sentence spoken directly TO the pilot ("you"), 5-14 words.
- Neutral, concise, operational voice. No roleplay, no emotes, no filler.
- Be specific to the event (name the system/item). Add a small useful remark when you can.
- NEVER just restate the event or echo these instructions. Never output fragments like "the pilot".
Answer as STRICT JSON only.

EXAMPLE
Event: the pilot set an in-game waypoint to Jita.
{"client":"Waypoint locked for Jita — mind the gate camps on the way in."}

EXAMPLE
Event: the pilot just opened the tool.
{"client":"Systems online. Ready when you are, capsuleer."}`;

/** Describe the current event as the user turn. */
function eventBlock(event: CompanionEvent): string {
  switch (event.type) {
    case 'app-load':
      return 'Event: the pilot just opened the tool.';
    case 'eve-action': {
      const verb =
        event.action === 'set-waypoint'
          ? 'set an in-game waypoint to'
          : event.action === 'open-market'
            ? 'opened the in-game market for'
            : 'opened the in-game contract for';
      return `Event: the pilot ${verb} ${event.target}.`;
    }
  }
}

/** JSON schema handed to Ollama as its structured-output `format`, so the small
 * model reliably emits the exact shape. */
export const REACTION_SCHEMA = {
  type: 'object',
  properties: { client: { type: 'string' } },
  required: ['client'],
} as const;

export function buildReactionPrompt(event: CompanionEvent): { system: string; user: string } {
  const system = BASE_IDENTITY;
  const user = `${eventBlock(event)}\nReply now as JSON with your "client" line.`;
  return { system, user };
}
