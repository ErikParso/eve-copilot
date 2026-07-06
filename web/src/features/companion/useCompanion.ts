import { useEffect, useRef } from 'react';
import { useStore } from 'jotai';
import { requestReaction } from './api';
import { dispatchCompanionEvent, subscribeCompanionEvents } from './events';
import { buildReactionPrompt, REACTION_SCHEMA } from './prompts';
import { companionDebugAtom, companionMessagesAtom, MSG_CAP } from './atoms';
import type { CompanionEvent } from './types';

/** Pull the spoken line out of the model's JSON. A tiny model can emit an odd
 * shape; anything unusable becomes a silent no-op. */
function parseClient(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const client = (raw as Record<string, unknown>).client;
  return typeof client === 'string' && client.trim() ? client.trim() : null;
}

const cap = <T>(arr: T[], max: number): T[] => (arr.length > max ? arr.slice(arr.length - max) : arr);

/**
 * Mount once (in Layout). Subscribes to companion events, processes them one at a
 * time (the model is single and slow), and appends each response to the panel
 * feed in localStorage. Also fires the one-time `app-load` greeting.
 */
export function useCompanion(): void {
  const store = useStore();
  const queue = useRef<CompanionEvent[]>([]);
  const running = useRef(false);

  useEffect(() => {
    let disposed = false;

    const handle = async (event: CompanionEvent) => {
      const debug = store.get(companionDebugAtom);
      const { system, user } = buildReactionPrompt(event);

      if (debug) {
        console.debug('[companion] context', {
          event: event.type,
          system,
          user,
          estTokens: Math.ceil((system + user).length / 4),
        });
      }

      let raw: unknown;
      try {
        raw = await requestReaction(system, user, REACTION_SCHEMA);
      } catch (err) {
        // Model offline / unreachable — stay quiet, panel shows its idle state.
        if (debug) console.debug('[companion] request failed (offline?)', err);
        return;
      }
      if (disposed) return;

      const client = parseClient(raw);
      if (debug) {
        (window as typeof window & { __companion?: unknown }).__companion = {
          messages: store.get(companionMessagesAtom),
          lastContext: { system, user },
          lastRaw: raw,
          lastClient: client,
        };
      }
      if (!client) return;

      const now = new Date().toISOString();
      store.set(
        companionMessagesAtom,
        cap(
          [...store.get(companionMessagesAtom), { id: crypto.randomUUID(), ts: now, eventType: event.type, text: client }],
          MSG_CAP,
        ),
      );
    };

    const drain = async () => {
      if (running.current) return;
      running.current = true;
      try {
        while (queue.current.length && !disposed) {
          await handle(queue.current.shift()!);
        }
      } finally {
        running.current = false;
      }
    };

    const unsub = subscribeCompanionEvents((event) => {
      queue.current.push(event);
      void drain();
    });

    // Greet on load (once per mount).
    dispatchCompanionEvent({ type: 'app-load' });

    return () => {
      disposed = true;
      unsub();
    };
  }, [store]);
}
