import type { CapturedMessage } from "../../shared/types";

export interface VendorObserver {
  readonly vendorName: string;
  attach(): void;
  detach(): void;
  onMessage(callback: (msg: CapturedMessage) => void): void;
}

/**
 * Helper: debounced MutationObserver callback.
 * Waits for DOM mutations to settle before calling handler.
 */
export function createDebouncedObserver(
  target: Node,
  handler: () => void,
  debounceMs = 500,
): MutationObserver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(handler, debounceMs);
  });
  observer.observe(target, { childList: true, subtree: true, characterData: true });
  return observer;
}

/** Extract conversation ID from URL path. */
export function extractConversationId(url: string, pattern: RegExp): string {
  const match = url.match(pattern);
  return match?.[1] ?? `unknown-${Date.now()}`;
}
