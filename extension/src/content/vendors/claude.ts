import type { CapturedMessage } from "../../shared/types";
import { type VendorObserver, createDebouncedObserver, extractConversationId } from "./base";

const SELECTOR_VERSION = 1;

/** Selectors for Claude.ai DOM elements. */
const SELECTORS = {
  humanMessage: "[data-testid='human-turn']",
  assistantMessage: "[data-testid='assistant-turn']",
  chatContainer: ".flex-1.overflow-y-auto, main",
};

export class ClaudeObserver implements VendorObserver {
  readonly vendorName = "claude";
  private callback: ((msg: CapturedMessage) => void) | null = null;
  private observer: MutationObserver | null = null;
  private seenMessages = new Set<string>();

  onMessage(callback: (msg: CapturedMessage) => void): void {
    this.callback = callback;
  }

  attach(): void {
    const container = document.querySelector(SELECTORS.chatContainer);
    if (!container) {
      console.warn(`[AtlasBridge] Claude: chat container not found (selector v${SELECTOR_VERSION})`);
      // Retry after DOM settles
      setTimeout(() => this.attach(), 2000);
      return;
    }

    this.scanMessages();
    this.observer = createDebouncedObserver(container, () => this.scanMessages(), 600);
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private scanMessages(): void {
    this.scanRole("user", SELECTORS.humanMessage);
    this.scanRole("assistant", SELECTORS.assistantMessage);
  }

  private scanRole(role: "user" | "assistant", selector: string): void {
    const elements = document.querySelectorAll(selector);
    elements.forEach((el) => {
      const text = el.textContent?.trim();
      if (!text) return;

      const key = `${role}:${text.slice(0, 100)}`;
      if (this.seenMessages.has(key)) return;
      this.seenMessages.add(key);

      const conversationId = extractConversationId(
        window.location.pathname,
        /\/chat\/([a-f0-9-]+)/,
      );

      this.callback?.({
        role,
        content: text,
        timestamp: new Date().toISOString(),
        vendor: this.vendorName,
        conversationId,
      });
    });
  }
}
