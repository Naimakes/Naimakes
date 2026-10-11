import { useEffect, useRef } from "react";
import { api, type LiveEvent } from "../api";

const readyTimeout = 8000;
const pollInterval = 20000;
const retryStream = 120000;

export function useLiveNotifications(
  userId: string | null,
  handlers: { onEvent: (event: LiveEvent) => void; onUnread: (unread: number) => void; onUpdate?: (event: LiveEvent) => void },
) {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    let disposed = false;
    let source: EventSource | null = null;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let after = 0;
    let polling = false;
    let inFlight = false;
    const delivered = new Set<string>();
    const deliver = (event: LiveEvent) => {
      if (!event?.notice?.id) return;
      if (event.update) {
        latest.current.onUnread(event.unread);
        latest.current.onUpdate?.(event);
        return;
      }
      if (delivered.has(event.notice.id)) return;
      delivered.add(event.notice.id);
      if (delivered.size > 400) delivered.delete(delivered.values().next().value!);
      after = Math.max(after, event.notice.created_at);
      latest.current.onEvent(event);
    };

    const stopPolling = () => {
      polling = false;
      if (pollTimer) clearTimeout(pollTimer);
      if (retryTimer) clearTimeout(retryTimer);
      pollTimer = retryTimer = undefined;
    };
    const poll = async (baseline: boolean) => {
      if (disposed || !polling) return;
      if (document.visibilityState === "visible") {
        inFlight = true;
        try {
          const r = await api<{ items: LiveEvent[]; unread: number; now: number }>(
            "/notifications/live" + (after ? "?after=" + after : ""),
          );
          if (disposed || !polling) return;
          if (baseline) {
            r.items.forEach((item) => delivered.add(item.notice.id));
            after = Math.max(after, r.now - 1000);
          } else r.items.forEach((item) => deliver({ ...item, unread: r.unread }));
          latest.current.onUnread(r.unread);
        } catch {
        } finally {
          inFlight = false;
        }
      }
      pollTimer = setTimeout(() => poll(false), pollInterval);
    };
    const fallBack = () => {
      source?.close();
      source = null;
      if (readyTimer) clearTimeout(readyTimer);
      if (disposed || polling) return;
      polling = true;
      poll(!after);
      retryTimer = setTimeout(() => {
        stopPolling();
        connect();
      }, retryStream);
    };
    const connect = () => {
      if (disposed || typeof EventSource === "undefined") return fallBack();
      const stream = new EventSource("/api/notifications/stream");
      source = stream;
      let ready = false;
      readyTimer = setTimeout(() => !ready && fallBack(), readyTimeout);
      stream.addEventListener("ready", (message) => {
        ready = true;
        if (readyTimer) clearTimeout(readyTimer);
        if (!after) after = Date.now();
        try {
          latest.current.onUnread(JSON.parse((message as MessageEvent).data).unread);
        } catch {}
      });
      stream.addEventListener("notice", (message) => {
        try {
          deliver(JSON.parse((message as MessageEvent).data));
        } catch {}
      });
      stream.onerror = () => {
        if (stream.readyState === EventSource.CLOSED && source === stream) fallBack();
      };
    };
    const visible = () => {
      if (document.visibilityState === "visible" && polling && !inFlight) {
        clearTimeout(pollTimer);
        poll(false);
      }
    };
    document.addEventListener("visibilitychange", visible);
    connect();
    return () => {
      disposed = true;
      source?.close();
      if (readyTimer) clearTimeout(readyTimer);
      stopPolling();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [userId]);
}
