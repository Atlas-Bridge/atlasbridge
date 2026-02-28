import type { CapturedMessage } from "../../shared/types";
import { type VendorObserver, createDebouncedObserver, extractConversationId } from "./base";

const SELECTOR_VERSION = 1;

/** Selectors for Gemini DOM elements. */
const SELECTORS = {
  userMessage: "user-query, .query-text, [data-testid='user-message']",
  assistantMessage: "model-response, .response-text, [data-testid='model-response']",
  chatContainer: ".conversation-container, main",
};

export class GeminiObserver implements VendorObserver {
  readonly vendorName = "gemini";
  private callback: ((msg: CapturedMessage) => void) | null = null;
  private observer: MutationObserver | null = null;
  private seenMessages = new Set<string>();

  onMessage(callback: (msg: CapturedMessage) => void): void {
    this.callback = callback;
  }

  attach(): void {
    const container = document.querySelector(SELECTORS.chatContainer);
    if (!container) {
      console.warn(`[AtlasBridge] Gemini: chat container not found (selector v${SELECTOR_VERSION})`);
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
    this.scanRole("user", SELECTORS.userMessage);
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
        /\/app\/([a-f0-9-]+)/,
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
