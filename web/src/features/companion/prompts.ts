// Prompt assembly. Three parts, from three places:
//   • GLOBAL_CONTEXT (persona.ts) → the `system` role: who the agent is.
//   • BRIEFS[action]  (briefs.ts)  → the `user` role: what this action is / how to react.
//   • event.data                   → the `user` role: the facts, as flat JSON.
// The reply is PLAIN TEXT (one sentence). No examples, no memory — those are
// deliberately elsewhere / later.
import { GLOBAL_CONTEXT } from './persona';
import { BRIEFS } from './briefs';
import type { CompanionEvent } from './types';

export function buildReactionPrompt(event: CompanionEvent): { system: string; user: string } {
  const brief = BRIEFS[event.action];
  const data = JSON.stringify(event.data ?? {});
  const user = `BRIEF: ${brief}\nDATA: ${data}\nReply now with your one-sentence line.`;
  return { system: GLOBAL_CONTEXT, user };
}
