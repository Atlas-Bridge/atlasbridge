export interface CapturedMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  vendor: string;
  conversationId: string;
}

export interface MonitorSession {
  tabId: number;
  vendor: string;
  conversationId: string;
  dashboardSessionId: string;
  messages: CapturedMessage[];
  lastSent: number;
  seqCounter: number;
}

export interface ExtensionSettings {
  dashboardUrl: string;
  enabled: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  dashboardUrl: "http://localhost:5000",
  enabled: true,
};

export type MessageType =
  | { type: "CAPTURED_MESSAGE"; payload: CapturedMessage }
  | { type: "GET_STATUS"; }
  | { type: "STATUS_RESPONSE"; sessions: { tabId: number; vendor: string; conversationId: string }[] };
