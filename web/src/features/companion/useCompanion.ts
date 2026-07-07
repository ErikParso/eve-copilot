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
 * Mount once (in Layout). Subscribes to companion events and fires one request per
 * event — no concurrency limits on either side; every reaction runs to completion.
 * Speaks each response (voice-only). Also fires the one-time `app-load` greeting.
 */
export function useCompanion(): void {
  const store = useStore();
  // Count of in-flight requests, to drive the orb's "thinking" state.
  const inFlight = useRef(0);
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

      // "thinking" while any request is in flight (drives the orb).
      inFlight.current += 1;
      store.set(companionBusyAtom, true);
      let reaction: Awaited<ReturnType<typeof requestReaction>>;
      try {
        reaction = await requestReaction(event.action, payload);
      } catch (err) {
        // Model offline / unreachable — stay quiet.
        if (debug) console.debug('[companion] request failed (offline?)', err);
        return;
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0) store.set(companionBusyAtom, false);
      }

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

      if (!store.get(companionMutedAtom)) playVoice(reaction.audio, reaction.mime);
    };

    // Fire a request per event immediately.
    const unsub = subscribeCompanionEvents((event) => {
      void handle(event);
    });

    // Greet on load — guarded so StrictMode's double-mount greets only once.
    if (!greeted.current) {
      greeted.current = true;
      dispatchCompanionEvent({ action: 'app-load' });
    }

    return unsub;
  }, [store]);
}
