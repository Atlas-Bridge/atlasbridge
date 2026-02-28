import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { MonitorSession, MonitorMessage } from "@shared/schema";
import { Activity, Globe, Monitor, Code2, User, Bot, X, Play, Square, Loader2, Radio, MessageSquare, Layers } from "lucide-react";

const VENDOR_META: Record<string, { label: string; color: string; icon: typeof Globe }> = {
  chatgpt:          { label: "ChatGPT",         color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", icon: Globe },
  claude:           { label: "Claude",           color: "bg-blue-500/10 text-blue-700 dark:text-blue-300",         icon: Globe },
  gemini:           { label: "Gemini",           color: "bg-orange-500/10 text-orange-700 dark:text-orange-300",   icon: Globe },
  "desktop-claude": { label: "Claude Desktop",   color: "bg-violet-500/10 text-violet-700 dark:text-violet-300",   icon: Monitor },
  "desktop-chatgpt":{ label: "ChatGPT Desktop",  color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",icon: Monitor },
  "vscode-claude":  { label: "VS Code / Claude", color: "bg-sky-500/10 text-sky-700 dark:text-sky-300",           icon: Code2 },
};

function vendorInfo(vendor: string) {
  return VENDOR_META[vendor] ?? { label: vendor, color: "bg-muted text-muted-foreground", icon: Globe };
}

function ago(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

interface DaemonStatus {
  running: boolean;
  startedAt?: string;
  logs: string[];
}

// ---------------------------------------------------------------------------
// Monitor Controls — start/stop desktop & VS Code monitors from dashboard
// ---------------------------------------------------------------------------

function MonitorControls() {
  const { data: daemons, isLoading } = useQuery<Record<string, DaemonStatus>>({
    queryKey: ["/api/monitor/daemons"],
    refetchInterval: 3_000,
  });

  const startMutation = useMutation({
    mutationFn: (type: string) => apiRequest("POST", `/api/monitor/daemons/${type}/start`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/monitor/daemons"] }),
  });

  const stopMutation = useMutation({
    mutationFn: (type: string) => apiRequest("POST", `/api/monitor/daemons/${type}/stop`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/monitor/daemons"] }),
  });

  const monitors = [
    {
      type: "desktop",
      label: "Desktop Apps",
      description: "Monitor Claude Desktop and ChatGPT macOS apps via Accessibility API",
      icon: Monitor,
    },
    {
      type: "vscode",
      label: "VS Code / Claude Code",
      description: "Monitor Claude Code sessions running in VS Code",
      icon: Code2,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Monitor Controls</CardTitle>
        <CardDescription className="text-xs">
          Start and stop AI conversation monitors directly from the dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {monitors.map((m) => {
          const status = daemons?.[m.type];
          const running = status?.running ?? false;
          const Icon = m.icon;
          const isPending = startMutation.isPending || stopMutation.isPending;

          return (
            <div
              key={m.type}
              className="flex items-center gap-3 p-3 rounded-lg border bg-card"
              data-testid={`monitor-control-${m.type}`}
            >
              <Icon className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{m.label}</span>
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full ${
                      running ? "bg-emerald-500 animate-pulse" : "bg-gray-400"
                    }`}
                  />
                  {running && status?.startedAt && (
                    <span className="text-[10px] text-muted-foreground">
                      since {ago(status.startedAt)}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{m.description}</p>
                {status?.logs && status.logs.length > 0 && (
                  <pre className="text-[10px] text-muted-foreground mt-1 font-mono truncate max-w-full">
                    {status.logs[status.logs.length - 1]}
                  </pre>
                )}
              </div>
              {running ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => stopMutation.mutate(m.type)}
                  disabled={isPending}
                  className="shrink-0"
                >
                  {isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Square className="w-3.5 h-3.5 mr-1" />
                  )}
                  Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => startMutation.mutate(m.type)}
                  disabled={isPending}
                  className="shrink-0"
                >
                  {isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5 mr-1" />
                  )}
                  Start
                </Button>
              )}
            </div>
          );
        })}

        {/* Browser extension info */}
        <div className="flex items-center gap-3 p-3 rounded-lg border bg-card">
          <Globe className="w-5 h-5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Browser Extension</span>
              <Badge variant="secondary" className="text-[9px]">Chrome</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Monitors ChatGPT, Claude, and Gemini web conversations.
              Load as unpacked extension from the <code className="text-[10px] bg-muted px-1 rounded">extension/dist/</code> directory.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Monitor Page
// ---------------------------------------------------------------------------

export default function MonitorPage() {
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<MonitorMessage[]>([]);
  const [lastSeq, setLastSeq] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: sessions, isLoading } = useQuery<MonitorSession[]>({
    queryKey: ["/api/monitor/sessions"],
    refetchInterval: 5_000,
  });

  // Reset messages when session changes
  useEffect(() => {
    setMessages([]);
    setLastSeq(0);
  }, [selectedSession]);

  // Poll for new messages
  const { data: newMessages } = useQuery<MonitorMessage[]>({
    queryKey: ["/api/monitor/sessions", selectedSession, "messages", lastSeq],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/monitor/sessions/${encodeURIComponent(selectedSession!)}/messages?after_seq=${lastSeq}`,
      ).then((r) => r.json()),
    enabled: Boolean(selectedSession),
    refetchInterval: 2_500,
  });

  useEffect(() => {
    if (newMessages && newMessages.length > 0) {
      setMessages((prev) => [...prev, ...newMessages]);
      setLastSeq(newMessages[newMessages.length - 1].seq);
    }
  }, [newMessages]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const activeSessions = (sessions ?? []).filter((s) => s.status === "active");
  const endedSessions = (sessions ?? []).filter((s) => s.status === "ended");
  const allSessions = sessions ?? [];
  const vendorCount = new Set(allSessions.map((s) => s.vendor)).size;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <Activity className="w-5 h-5 text-muted-foreground" />
          Activity
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          All AI conversation activity across browser, desktop, and IDE.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Radio className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{activeSessions.length}</p>
              <p className="text-xs text-muted-foreground">Active Sessions</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <MessageSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{allSessions.length}</p>
              <p className="text-xs text-muted-foreground">Total Sessions</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-500/10">
              <Layers className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{vendorCount}</p>
              <p className="text-xs text-muted-foreground">Vendors</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls — start/stop monitors */}
      <MonitorControls />

      {/* Session list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">
            Monitored Sessions
            {activeSessions.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {activeSessions.length} active
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (sessions ?? []).length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground" data-testid="text-no-sessions">
              No monitored sessions yet. Start a monitor above or install the browser extension.
            </div>
          ) : (
            <div className="divide-y">
              {[...activeSessions, ...endedSessions].map((session) => {
                const v = vendorInfo(session.vendor);
                const VendorIcon = v.icon;
                const isSelected = selectedSession === session.id;
                return (
                  <button
                    key={session.id}
                    className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:bg-muted/50 ${
                      isSelected ? "bg-primary/5 border-l-2 border-primary" : ""
                    }`}
                    onClick={() => setSelectedSession(isSelected ? null : session.id)}
                    data-testid={`monitor-session-${session.id}`}
                  >
                    <VendorIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className={`text-[10px] ${v.color}`}>
                          {v.label}
                        </Badge>
                        <span
                          className={`inline-block w-1.5 h-1.5 rounded-full ${
                            session.status === "active" ? "bg-emerald-500" : "bg-gray-400"
                          }`}
                        />
                        <span className="text-[11px] text-muted-foreground">
                          {ago(session.created_at)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5 font-mono">
                        {session.tab_url || session.conversation_id}
                      </div>
                    </div>
                    <code className="text-[10px] text-muted-foreground font-mono shrink-0">
                      {session.id.slice(0, 8)}
                    </code>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transcript view */}
      {selectedSession && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              Conversation
              {messages.length > 0 && (
                <Badge variant="secondary" className="text-[10px] ml-auto">
                  {messages.length} messages
                </Badge>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="w-6 h-6 ml-1"
                onClick={() => setSelectedSession(null)}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div
              className="max-h-[500px] overflow-y-auto"
              data-testid="monitor-transcript"
            >
              {messages.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Waiting for messages...
                </div>
              ) : (
                <div className="divide-y">
                  {messages.map((msg) => (
                    <div
                      key={`${msg.session_id}-${msg.seq}`}
                      className={`px-4 py-2 ${
                        msg.role === "user"
                          ? "bg-blue-500/5 border-l-2 border-blue-500/30"
                          : "bg-muted/30"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        {msg.role === "user" ? (
                          <User className="w-3 h-3 text-blue-500" />
                        ) : (
                          <Bot className="w-3 h-3 text-muted-foreground" />
                        )}
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {msg.role === "user" ? "You" : "Assistant"}
                        </span>
                        <Badge variant="secondary" className={`text-[9px] ${vendorInfo(msg.vendor).color}`}>
                          {vendorInfo(msg.vendor).label}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {ago(msg.captured_at)}
                        </span>
                      </div>
                      <pre className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-foreground/90">
                        {msg.content}
                      </pre>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
