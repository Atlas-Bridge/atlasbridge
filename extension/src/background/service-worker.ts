import type { CapturedMessage, MonitorSession } from "../shared/types";
import { DashboardApiClient, getSettings } from "../shared/api-client";

const sessions = new Map<number, MonitorSession>();
let apiClient: DashboardApiClient | null = null;

async function ensureClient(): Promise<DashboardApiClient> {
  if (!apiClient) {
    const settings = await getSettings();
    apiClient = new DashboardApiClient(settings.dashboardUrl);
  }
  return apiClient;
}

async function handleCapturedMessage(tabId: number, msg: CapturedMessage): Promise<void> {
  let session = sessions.get(tabId);

  if (!session) {
    // Create a new monitoring session
    try {
      const client = await ensureClient();
      const tab = await chrome.tabs.get(tabId);
      const result = await client.createSession(
        msg.vendor,
        msg.conversationId,
        tab.url ?? "",
      );
      session = {
        tabId,
        vendor: msg.vendor,
        conversationId: msg.conversationId,
        dashboardSessionId: result.id,
        messages: [],
        lastSent: Date.now(),
        seqCounter: 0,
      };
      sessions.set(tabId, session);
      console.log(`[AtlasBridge] Session created: ${result.id} for ${msg.vendor}`);
    } catch (err) {
      console.error("[AtlasBridge] Failed to create session:", err);
      return;
    }
  }

  session.messages.push(msg);
}

async function flushAllSessions(): Promise<void> {
  const settings = await getSettings();
  if (!settings.enabled) return;

  const client = await ensureClient();

  for (const [tabId, session] of sessions) {
    if (session.messages.length === 0) continue;

    const batch = session.messages.splice(0);
    const seqStart = session.seqCounter + 1;
    try {
      await client.sendMessages(session.dashboardSessionId, batch, seqStart);
      session.seqCounter += batch.length;
      session.lastSent = Date.now();
      console.log(`[AtlasBridge] Flushed ${batch.length} messages for tab ${tabId}`);
    } catch (err) {
      // Re-queue on failure
      session.messages.unshift(...batch);
      console.error(`[AtlasBridge] Flush failed for tab ${tabId}:`, err);
    }
  }
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CAPTURED_MESSAGE" && sender.tab?.id) {
    handleCapturedMessage(sender.tab.id, message.payload);
    sendResponse({ ok: true });
  }

  if (message.type === "GET_STATUS") {
    const sessionList = Array.from(sessions.values()).map((s) => ({
      tabId: s.tabId,
      vendor: s.vendor,
      conversationId: s.conversationId,
    }));
    sendResponse({ type: "STATUS_RESPONSE", sessions: sessionList });
  }

  return true; // keep message channel open for async response
});

// Clean up when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  sessions.delete(tabId);
});

// Flush every 5 seconds
setInterval(flushAllSessions, 5000);

// Settings change listener — recreate client
chrome.storage.onChanged.addListener((changes) => {
  if (changes.dashboardUrl) {
    apiClient = null;
  }
});

console.log("[AtlasBridge] Service worker started");
