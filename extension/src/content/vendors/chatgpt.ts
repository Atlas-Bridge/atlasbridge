import type { CapturedMessage } from "../../shared/types";
import { type VendorObserver, createDebouncedObserver, extractConversationId } from "./base";

const SELECTOR_VERSION = 1;

/** Selectors for ChatGPT DOM elements (may need updating when OpenAI changes their UI). */
const SELECTORS = {
  messageContainer: "[data-message-author-role]",
  userMessage: '[data-message-author-role="user"]',
  assistantMessage: '[data-message-author-role="assistant"]',
  streaming: ".result-streaming",
  chatArea: "main",
};

export class ChatGPTObserver implements VendorObserver {
  readonly vendorName = "chatgpt";
  private callback: ((msg: CapturedMessage) => void) | null = null;
  private observer: MutationObserver | null = null;
  private seenMessages = new Set<string>();

  onMessage(callback: (msg: CapturedMessage) => void): void {
    this.callback = callback;
  }

  attach(): void {
    const chatArea = document.querySelector(SELECTORS.chatArea);
    if (!chatArea) {
      console.warn(`[AtlasBridge] ChatGPT: chat area not found (selector v${SELECTOR_VERSION})`);
      return;
    }

    // Capture existing messages
    this.scanMessages();

    // Watch for new messages
    this.observer = createDebouncedObserver(chatArea, () => this.scanMessages(), 800);
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private scanMessages(): void {
    // Don't capture while streaming
    if (document.querySelector(SELECTORS.streaming)) return;

    const messages = document.querySelectorAll(SELECTORS.messageContainer);
    messages.forEach((el) => {
      const role = el.getAttribute("data-message-author-role");
      if (role !== "user" && role !== "assistant") return;

      const text = el.textContent?.trim();
      if (!text) return;

      const key = `${role}:${text.slice(0, 100)}`;
      if (this.seenMessages.has(key)) return;
      this.seenMessages.add(key);

      const conversationId = extractConversationId(
        window.location.pathname,
        /\/c\/([a-f0-9-]+)/,
      );

      this.callback?.({
        role: role as "user" | "assistant",
        content: text,
        timestamp: new Date().toISOString(),
        vendor: this.vendorName,
        conversationId,
      });
    });
  }
}
