import type { CapturedMessage } from "./types";

function uuid(): string {
  return crypto.randomUUID();
}

export class DashboardApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async createSession(
    vendor: string,
    conversationId: string,
    tabUrl: string,
  ): Promise<{ id: string }> {
    const id = uuid();
    const res = await fetch(`${this.baseUrl}/api/monitor/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, vendor, conversation_id: conversationId, tab_url: tabUrl }),
    });
    if (!res.ok) throw new Error(`Dashboard API error: ${res.status}`);
    return res.json();
  }

  async sendMessages(
    sessionId: string,
    messages: CapturedMessage[],
    seqStart: number,
  ): Promise<void> {
    const payload = messages.map((m, i) => ({
      role: m.role,
      content: m.content,
      vendor: m.vendor,
      seq: seqStart + i,
      captured_at: m.timestamp,
    }));
    const res = await fetch(
      `${this.baseUrl}/api/monitor/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload }),
      },
    );
    if (!res.ok) throw new Error(`Dashboard API error: ${res.status}`);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/version`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export async function getSettings(): Promise<{ dashboardUrl: string; enabled: boolean }> {
  const result = await chrome.storage.sync.get({
    dashboardUrl: "http://localhost:5000",
    enabled: true,
  });
  return result as { dashboardUrl: string; enabled: boolean };
}

export async function saveSettings(settings: Partial<{ dashboardUrl: string; enabled: boolean }>): Promise<void> {
  await chrome.storage.sync.set(settings);
}
