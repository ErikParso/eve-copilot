import { useEffect, useRef } from 'react';
import { useStore } from 'jotai';
import { requestReaction } from './api';
import { dispatchCompanionEvent, subscribeCompanionEvents } from './events';
import { buildBaseContext } from './context';
import { playVoice } from './voice';
import { COMPANION_ENABLED } from './config';
import { companionBusyAtom, companionDebugAtom, companionMutedAtom } from './atoms';
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

/**
 * Mount once (in Layout). Subscribes to companion events, processes them one at a
 * time (the model is single and slow), and speaks each response (voice-only — no
 * UI). Also fires the one-time `app-load` greeting.
 */
export function useCompanion(): void {
  const store = useStore();
  const queue = useRef<CompanionEvent[]>([]);
  const running = useRef(false);
  // Persists across StrictMode's mount→unmount→remount so we greet exactly once.
  const greeted = useRef(false);

  useEffect(() => {
    if (!COMPANION_ENABLED) return; // companion disabled → never subscribe or greet

    const handle = async (event: CompanionEvent) => {
      const debug = store.get(companionDebugAtom);
      // Merge the always-present base context with this action's own data. The
      // server turns this whole object into the DATA payload of the prompt.
      const payload = { ...buildBaseContext(store), ...(event.data ?? {}) };

      if (debug) console.debug('[companion] request', { action: event.action, payload });

      // "thinking" while the request is in flight (drives the orb).
      store.set(companionBusyAtom, true);
      let reaction: Awaited<ReturnType<typeof requestReaction>>;
      try {
        reaction = await requestReaction(event.action, payload);
      } catch (err) {
        // Model offline / unreachable — stay quiet.
        store.set(companionBusyAtom, false);
        if (debug) console.debug('[companion] request failed (offline?)', err);
        return;
      }
      store.set(companionBusyAtom, false);

      const client = cleanLine(reaction.text);
      if (debug) {
        (window as typeof window & { __companion?: unknown }).__companion = {
          lastPayload: payload,
          lastText: reaction.text,
          hasAudio: reaction.audio !== null,
          lastClient: client,
        };
      }
      if (!client) return;

      if (!store.get(companionMutedAtom)) playVoice(client, reaction.audio);
    };

    const drain = async () => {
      if (running.current) return;
      running.current = true;
      try {
        while (queue.current.length) {
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

    // Greet on load — guarded so StrictMode's double-mount greets only once.
    if (!greeted.current) {
      greeted.current = true;
      dispatchCompanionEvent({ action: 'app-load' });
    }

    return unsub;
  }, [store]);
}
