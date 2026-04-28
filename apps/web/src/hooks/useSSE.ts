import { useEffect, useRef, useState } from 'react';

const globalSSERegistry = new Map<string, EventSource>();

export interface UseSSEOptions {
  enabled?: boolean;
  withCredentials?: boolean;
  events?: string[];
  maxRetries?: number;
  retryIntervalMs?: number;
  maxRetryIntervalMs?: number;
  retryBackoffMultiplier?: number;
  retryJitterRatio?: number;
  onOpen?: () => void;
  onEvent?: (event: MessageEvent) => void;
  onError?: (error: Event) => void;
}

export function useSSE(url: string, options: UseSSEOptions = {}) {
  const {
    enabled = true,
    withCredentials = true,
    events = [],
    maxRetries = 5,
    retryIntervalMs = 3000,
    maxRetryIntervalMs = 30000,
    retryBackoffMultiplier = 1.8,
    retryJitterRatio = 0.2,
    onOpen,
    onEvent,
    onError,
  } = options;

  const [connected, setConnected] = useState(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return;
    }

    let cancelled = false;

    const cleanupTimers = () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const teardown = () => {
      if (eventSourceRef.current) {
        const registered = globalSSERegistry.get(url);
        if (registered === eventSourceRef.current) {
          globalSSERegistry.delete(url);
        }
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };

    const connect = () => {
      if (cancelled) {
        return;
      }

      teardown();

      const existing = globalSSERegistry.get(url);
      if (existing) {
        existing.close();
        globalSSERegistry.delete(url);
      }

      const source = new EventSource(url, { withCredentials });
      eventSourceRef.current = source;
      globalSSERegistry.set(url, source);

      const handleOpen = () => {
        retryCountRef.current = 0;
        setConnected(true);
        onOpen?.();
      };

      const handleEvent = (event: MessageEvent) => {
        onEvent?.(event);
      };

      const handleError = (event: Event) => {
        setConnected(false);
        onError?.(event);

        teardown();

        if (retryCountRef.current >= maxRetries) {
          return;
        }

        retryCountRef.current += 1;
        const attempt = retryCountRef.current;
        const exponentialDelay = Math.min(
          maxRetryIntervalMs,
          retryIntervalMs * Math.pow(retryBackoffMultiplier, Math.max(0, attempt - 1)),
        );
        const jitterScale = 1 + ((Math.random() * 2 - 1) * Math.max(0, retryJitterRatio));
        const hiddenTabPenalty = typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 1.5 : 1;
        const offlinePenalty = typeof navigator !== 'undefined' && navigator.onLine === false ? 2 : 1;
        const nextDelay = Math.max(
          retryIntervalMs,
          Math.round(exponentialDelay * jitterScale * hiddenTabPenalty * offlinePenalty),
        );

        cleanupTimers();
        retryTimerRef.current = setTimeout(connect, nextDelay);
      };

      source.onopen = handleOpen;
      source.onmessage = handleEvent;
      source.onerror = handleError;

      events.forEach((name) => {
        source.addEventListener(name, handleEvent as EventListener);
      });
    };

    connect();

    return () => {
      cancelled = true;
      cleanupTimers();
      teardown();
      setConnected(false);
    };
  }, [
    enabled,
    events,
    maxRetries,
    maxRetryIntervalMs,
    onError,
    onEvent,
    onOpen,
    retryBackoffMultiplier,
    retryIntervalMs,
    retryJitterRatio,
    url,
    withCredentials,
  ]);

  return { connected };
}
