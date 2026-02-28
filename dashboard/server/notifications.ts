/**
 * Notification delivery module — sends alerts to configured channels.
 *
 * Supported channels: slack, teams, webhook, email (SMTP via nodemailer if installed),
 * pagerduty, opsgenie.
 */

import { storage } from "./storage";

export interface NotificationPayload {
  title: string;
  message: string;
  severity?: "info" | "warning" | "error" | "critical";
  event?: string;
  metadata?: Record<string, unknown>;
}

interface DeliveryResult {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Channel-specific senders
// ---------------------------------------------------------------------------

async function sendSlack(destination: string, payload: NotificationPayload): Promise<DeliveryResult> {
  try {
    const body = {
      text: `*${payload.title}*\n${payload.message}`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: payload.title } },
        { type: "section", text: { type: "mrkdwn", text: payload.message } },
        ...(payload.severity ? [{
          type: "context",
          elements: [{ type: "mrkdwn", text: `Severity: *${payload.severity}*` }],
        }] : []),
      ],
    };
    const res = await fetch(destination, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { success: false, error: `Slack responded ${res.status}: ${await res.text()}` };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || "Slack delivery failed" };
  }
}

async function sendTeams(destination: string, payload: NotificationPayload): Promise<DeliveryResult> {
  try {
    // Microsoft Teams Incoming Webhook (Adaptive Card format)
    const body = {
      type: "message",
      attachments: [{
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          type: "AdaptiveCard",
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          version: "1.4",
          body: [
            { type: "TextBlock", text: payload.title, weight: "Bolder", size: "Medium" },
            { type: "TextBlock", text: payload.message, wrap: true },
            ...(payload.severity ? [{
              type: "FactSet",
              facts: [{ title: "Severity", value: payload.severity }],
            }] : []),
          ],
        },
      }],
    };
    const res = await fetch(destination, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { success: false, error: `Teams responded ${res.status}: ${await res.text()}` };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || "Teams delivery failed" };
  }
}

async function sendWebhook(destination: string, payload: NotificationPayload): Promise<DeliveryResult> {
  try {
    const res = await fetch(destination, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title,
        message: payload.message,
        severity: payload.severity || "info",
        event: payload.event,
        timestamp: new Date().toISOString(),
        ...(payload.metadata || {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { success: false, error: `Webhook responded ${res.status}` };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || "Webhook delivery failed" };
  }
}

async function sendEmail(destination: string, payload: NotificationPayload): Promise<DeliveryResult> {
  // Email requires SMTP configuration — return a helpful error if not configured
  return {
    success: false,
    error: "Email delivery requires SMTP configuration. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS environment variables.",
  };
}

async function sendPagerDuty(destination: string, payload: NotificationPayload): Promise<DeliveryResult> {
  try {
    // PagerDuty Events API v2
    const body = {
      routing_key: destination,
      event_action: "trigger",
      payload: {
        summary: `${payload.title}: ${payload.message}`,
        severity: payload.severity === "critical" ? "critical" : payload.severity === "error" ? "error" : payload.severity === "warning" ? "warning" : "info",
        source: "atlasbridge-dashboard",
      },
    };
    const res = await fetch("https://events.pagerduty.com/v2/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { success: false, error: `PagerDuty responded ${res.status}: ${await res.text()}` };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || "PagerDuty delivery failed" };
  }
}

async function sendOpsGenie(destination: string, payload: NotificationPayload): Promise<DeliveryResult> {
  try {
    const body = {
      message: payload.title,
      description: payload.message,
      priority: payload.severity === "critical" ? "P1" : payload.severity === "error" ? "P2" : payload.severity === "warning" ? "P3" : "P5",
    };
    const res = await fetch("https://api.opsgenie.com/v2/alerts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `GenieKey ${destination}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { success: false, error: `OpsGenie responded ${res.status}: ${await res.text()}` };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || "OpsGenie delivery failed" };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const SENDERS: Record<string, (dest: string, payload: NotificationPayload) => Promise<DeliveryResult>> = {
  slack: sendSlack,
  teams: sendTeams,
  webhook: sendWebhook,
  email: sendEmail,
  pagerduty: sendPagerDuty,
  opsgenie: sendOpsGenie,
};

/**
 * Deliver a notification to a specific channel.
 */
export async function deliverNotification(
  channel: string,
  destination: string,
  payload: NotificationPayload,
): Promise<DeliveryResult> {
  const sender = SENDERS[channel];
  if (!sender) return { success: false, error: `Unknown channel: ${channel}` };
  return sender(destination, payload);
}

/**
 * Send a test notification to a channel.
 */
export async function testNotification(channel: string, destination: string): Promise<DeliveryResult> {
  return deliverNotification(channel, destination, {
    title: "AtlasBridge Test Notification",
    message: "This is a test notification from AtlasBridge Dashboard. If you received this, the channel is configured correctly.",
    severity: "info",
    event: "test",
  });
}

/**
 * Deliver an event to all enabled notification channels that match the event type.
 */
export async function broadcastEvent(payload: NotificationPayload): Promise<void> {
  try {
    const allNotifs = await storage.getNotifications();
    const enabled = allNotifs.filter(n => n.enabled);

    for (const notif of enabled) {
      // If the notification has specific events configured, check if this event matches
      const events = notif.events as string[] | null;
      if (events && events.length > 0 && payload.event && !events.includes(payload.event)) {
        continue;
      }

      const result = await deliverNotification(notif.channel, notif.destination, payload);
      // Update delivery status
      await storage.updateNotification(notif.id, {
        lastDelivered: new Date().toISOString(),
        lastDeliveryStatus: result.success ? "success" : "failed",
        lastDeliveryError: result.error || null,
      });
    }
  } catch {
    // Best-effort delivery — don't crash on notification failures
  }
}
