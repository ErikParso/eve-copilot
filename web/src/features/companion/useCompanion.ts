import { useEffect, useRef } from 'react';
import { useStore } from 'jotai';
import { requestReaction } from './api';
import { dispatchCompanionEvent, subscribeCompanionEvents } from './events';
import { buildReactionPrompt } from './prompts';
import { companionDebugAtom, companionMessagesAtom, MSG_CAP } from './atoms';
import type { CompanionEvent } from './types';

/** Tidy the model's plain-text reply into a single clean line: first non-empty
 * line, stripped of wrapping quotes / stray label. Empty → silent no-op. */
function cleanLine(text: string): string | null {
  const first = text
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean);
  if (!first) return null;
  const stripped = first.replace(/^["'`]+|["'`]+$/g, '').trim();
  return stripped || null;
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
          action: event.action,
          system,
          user,
          estTokens: Math.ceil((system + user).length / 4),
        });
      }

      let raw: string;
      try {
        raw = await requestReaction(system, user);
      } catch (err) {
        // Model offline / unreachable — stay quiet, panel shows its idle state.
        if (debug) console.debug('[companion] request failed (offline?)', err);
        return;
      }
      if (disposed) return;

      const client = cleanLine(raw);
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
          [...store.get(companionMessagesAtom), { id: crypto.randomUUID(), ts: now, action: event.action, text: client }],
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
    dispatchCompanionEvent({ action: 'app-load' });

    return () => {
      disposed = true;
      unsub();
    };
  }, [store]);
}
