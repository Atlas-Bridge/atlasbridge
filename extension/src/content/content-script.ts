import type { VendorObserver } from "./vendors/base";
import { ChatGPTObserver } from "./vendors/chatgpt";
import { ClaudeObserver } from "./vendors/claude";
import { GeminiObserver } from "./vendors/gemini";

function detectVendor(): VendorObserver | null {
  const url = window.location.hostname;
  if (url.includes("chatgpt.com") || url.includes("chat.openai.com")) {
    return new ChatGPTObserver();
  }
  if (url.includes("claude.ai")) {
    return new ClaudeObserver();
  }
  if (url.includes("gemini.google.com")) {
    return new GeminiObserver();
  }
  return null;
}

const observer = detectVendor();
if (observer) {
  console.log(`[AtlasBridge] Monitoring ${observer.vendorName}`);

  observer.onMessage((msg) => {
    chrome.runtime.sendMessage({
      type: "CAPTURED_MESSAGE",
      payload: msg,
    });
  });

  observer.attach();

  // Clean up on page unload
  window.addEventListener("beforeunload", () => {
    observer.detach();
  });
}
