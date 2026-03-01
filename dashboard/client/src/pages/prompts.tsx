import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type { MonitorMessage, MonitorSessionWithCounts, WorkspaceGroup, HookApproval } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { formatTimestamp, sanitizeText } from "@/lib/utils";
import {
  Search, User, Bot, MessageSquare, Wrench, CheckCircle2, XCircle,
  FolderOpen, Filter, ShieldCheck, Clock, ChevronRight, ShieldOff,
  HelpCircle, Send, Copy, ChevronDown, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function workspaceName(conversationId: string, tabUrl: string): string {
  // Strip JSONL UUID suffix if present (new format: claude-code-/path:uuid)
  const cleanId = conversationId.replace(/:[0-9a-f-]{36}$/, "");
  const url = tabUrl || cleanId;
  const parts = url.replace(/^vscode:\/\/claude-code\//, "").split("/");
  const last = parts[parts.length - 1];
  if (last && last !== url) return last;
  if (cleanId.startsWith("claude-code-")) {
    const path = cleanId.replace("claude-code-", "");
    const segments = path.split("/");
    return segments[segments.length - 1] || "Session";
  }
  return cleanId.slice(0, 12);
}

/** Extract short JSONL UUID label from conversation_id for child sessions. */
function sessionLabel(session: MonitorSessionWithCounts): string {
  const parts = session.conversation_id.split(":");
  if (parts.length >= 2) {
    const uuid = parts[parts.length - 1];
    return uuid.slice(0, 8);
  }
  return workspaceName(session.conversation_id, session.tab_url);
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

type ViewFilter = "all" | "approvals" | "tools";

function isPendingMessage(msg: MonitorMessage): boolean {
  return msg.permission_mode === "pending";
}

function isApprovalMessage(msg: MonitorMessage): boolean {
  return msg.permission_mode === "approved" || msg.permission_mode === "rejected";
}

function isToolMessage(msg: MonitorMessage): boolean {
  return !!msg.tool_name;
}

/** Build a map from tool_use_id → resolution message (approved/rejected). */
function buildResolutionMap(messages: MonitorMessage[]): Map<string, MonitorMessage> {
  const map = new Map<string, MonitorMessage>();
  for (const msg of messages) {
    if (msg.tool_use_id && (msg.permission_mode === "approved" || msg.permission_mode === "rejected")) {
      map.set(msg.tool_use_id, msg);
    }
  }
  return map;
}

function filterMessages(
  messages: MonitorMessage[],
  filter: ViewFilter,
  resolutionMap: Map<string, MonitorMessage>,
): MonitorMessage[] {
  const resolvedIds = new Set(resolutionMap.keys());
  const deduped = messages.filter((m) => {
    if (isPendingMessage(m)) return true;
    if (m.tool_use_id && resolvedIds.has(m.tool_use_id) && isApprovalMessage(m)) return false;
    return true;
  });

  switch (filter) {
    case "approvals":
      return deduped.filter((m) => isPendingMessage(m) || isApprovalMessage(m) || isToolMessage(m));
    case "tools":
      return deduped.filter(isToolMessage);
    default:
      return deduped;
  }
}

// ---------------------------------------------------------------------------
// Workspace grouping
// ---------------------------------------------------------------------------

type SessionOrGroup =
  | { type: "session"; session: MonitorSessionWithCounts }
  | { type: "group"; group: WorkspaceGroup };

function groupSessionsByWorkspace(
  sessions: MonitorSessionWithCounts[],
): SessionOrGroup[] {
  const byWorkspace = new Map<string, MonitorSessionWithCounts[]>();
  const ungrouped: MonitorSessionWithCounts[] = [];

  for (const s of sessions) {
    const key = s.workspace_key;
    if (!key) {
      ungrouped.push(s);
      continue;
    }
    if (!byWorkspace.has(key)) byWorkspace.set(key, []);
    byWorkspace.get(key)!.push(s);
  }

  const items: SessionOrGroup[] = [];

  // Ungrouped sessions → flat
  for (const s of ungrouped) {
    items.push({ type: "session", session: s });
  }

  for (const [wsKey, wsSessions] of byWorkspace) {
    if (wsSessions.length === 1) {
      // Single session in workspace — show flat (no expand noise)
      items.push({ type: "session", session: wsSessions[0] });
    } else {
      // Multiple sessions — create group
      items.push({
        type: "group",
        group: {
          workspace_key: wsKey,
          workspace_name: workspaceName(wsKey, wsSessions[0].tab_url),
          sessions: wsSessions,
          total_messages: wsSessions.reduce((a, s) => a + s.message_count, 0),
          total_pending: wsSessions.reduce((a, s) => a + s.pending_count, 0),
          total_approvals: wsSessions.reduce((a, s) => a + s.approval_count, 0),
          last_activity: wsSessions
            .map((s) => s.last_message_at)
            .filter(Boolean)
            .sort()
            .reverse()[0] ?? null,
        },
      });
    }
  }

  // Sort by last activity descending
  items.sort((a, b) => {
    const aTime = a.type === "session" ? a.session.last_message_at : a.group.last_activity;
    const bTime = b.type === "session" ? b.session.last_message_at : b.group.last_activity;
    return (bTime ?? "").localeCompare(aTime ?? "");
  });

  return items;
}

// ---------------------------------------------------------------------------
// Session list panel (left)
// ---------------------------------------------------------------------------

function SessionRow({
  session,
  selected,
  onSelect,
  indent = false,
}: {
  session: MonitorSessionWithCounts;
  selected: boolean;
  onSelect: (id: string) => void;
  indent?: boolean;
}) {
  const label = indent
    ? sessionLabel(session)
    : workspaceName(session.conversation_id, session.tab_url);

  return (
    <button
      onClick={() => onSelect(session.id)}
      className={cn(
        "w-full text-left px-3 py-3 hover:bg-muted/50 transition-colors",
        selected && "bg-muted",
        indent && "pl-8",
      )}
      data-testid={`session-${session.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {indent ? (
            <MessageSquare className="w-3 h-3 text-muted-foreground shrink-0" />
          ) : (
            <FolderOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          )}
          <span className={cn("font-medium truncate", indent ? "text-xs" : "text-sm")}>
            {label}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {relativeTime(session.last_message_at)}
        </span>
      </div>
      <div className={cn("flex items-center gap-2 mt-1.5", indent ? "ml-4" : "ml-5")}>
        <span className="text-[11px] text-muted-foreground">
          {session.message_count} msg{session.message_count !== 1 ? "s" : ""}
        </span>
        {session.pending_count > 0 && (
          <Badge
            variant="secondary"
            className="text-[10px] gap-0.5 px-1.5 py-0 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          >
            <Clock className="w-2.5 h-2.5" />
            {session.pending_count} pending
          </Badge>
        )}
        {session.approval_count > 0 && (
          <Badge
            variant="secondary"
            className="text-[10px] gap-0.5 px-1.5 py-0 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          >
            <CheckCircle2 className="w-2.5 h-2.5" />
            {session.approval_count}
          </Badge>
        )}
      </div>
    </button>
  );
}

function WorkspaceGroupRow({
  group,
  selectedId,
  onSelect,
}: {
  group: WorkspaceGroup;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const containsSelected = group.sessions.some((s) => s.id === selectedId);
  const [open, setOpen] = useState(containsSelected);

  // Auto-expand when user selects a child session
  useEffect(() => {
    if (containsSelected && !open) setOpen(true);
  }, [containsSelected, open]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full text-left px-3 py-3 hover:bg-muted/50 transition-colors">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <ChevronRight
              className={cn(
                "w-3 h-3 text-muted-foreground shrink-0 transition-transform",
                open && "rotate-90",
              )}
            />
            <FolderOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">
              {group.workspace_name}
            </span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
              {group.sessions.length}
            </Badge>
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {relativeTime(group.last_activity)}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1.5 ml-8">
          <span className="text-[11px] text-muted-foreground">
            {group.total_messages} msg{group.total_messages !== 1 ? "s" : ""}
          </span>
          {group.total_pending > 0 && (
            <Badge
              variant="secondary"
              className="text-[10px] gap-0.5 px-1.5 py-0 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            >
              <Clock className="w-2.5 h-2.5" />
              {group.total_pending} pending
            </Badge>
          )}
          {group.total_approvals > 0 && (
            <Badge
              variant="secondary"
              className="text-[10px] gap-0.5 px-1.5 py-0 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            >
              <CheckCircle2 className="w-2.5 h-2.5" />
              {group.total_approvals}
            </Badge>
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t">
          {group.sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              selected={selectedId === session.id}
              onSelect={onSelect}
              indent
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SessionList({
  sessions,
  selectedId,
  onSelect,
  isLoading,
}: {
  sessions: MonitorSessionWithCounts[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
}) {
  const [search, setSearch] = useState("");

  const items = useMemo(() => groupSessionsByWorkspace(sessions), [sessions]);

  const filtered = search
    ? items.filter((item) => {
        const q = search.toLowerCase();
        if (item.type === "session") {
          const name = workspaceName(item.session.conversation_id, item.session.tab_url).toLowerCase();
          return name.includes(q) || item.session.conversation_id.toLowerCase().includes(q);
        }
        return (
          item.group.workspace_name.toLowerCase().includes(q) ||
          item.group.sessions.some((s) => s.conversation_id.toLowerCase().includes(q))
        );
      })
    : items;

  if (isLoading) {
    return (
      <div className="p-3 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search sessions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
            data-testid="input-session-search"
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        {filtered.length === 0 ? (
          <div className="p-6 text-center">
            <MessageSquare className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">
              {sessions.length === 0
                ? "No sessions yet. Start a VS Code monitor from the Monitor page to capture prompts."
                : "No sessions match your search."}
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map((item) =>
              item.type === "session" ? (
                <SessionRow
                  key={item.session.id}
                  session={item.session}
                  selected={selectedId === item.session.id}
                  onSelect={onSelect}
                />
              ) : (
                <WorkspaceGroupRow
                  key={item.group.workspace_key}
                  group={item.group}
                  selectedId={selectedId}
                  onSelect={onSelect}
                />
              ),
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message thread panel (right)
// ---------------------------------------------------------------------------

function MessageThread({
  sessionId,
  filter,
}: {
  sessionId: string | null;
  filter: ViewFilter;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: rawMessages, isLoading } = useQuery<MonitorMessage[]>({
    queryKey: ["/api/monitor/sessions", sessionId, "messages"],
    queryFn: async () => {
      if (!sessionId) return [];
      const res = await fetch(
        `/api/monitor/sessions/${sessionId}/messages?limit=500`,
      );
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
    enabled: !!sessionId,
    refetchInterval: 3000,
  });

  const resolutionMap = useMemo(
    () => buildResolutionMap(rawMessages ?? []),
    [rawMessages],
  );

  const messages = useMemo(
    () => filterMessages(rawMessages ?? [], filter, resolutionMap),
    [rawMessages, filter, resolutionMap],
  );

  // Track which message is expanded (only one at a time)
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const toggleExpand = useCallback((id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <MessageSquare className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Select a session to view prompts
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <ShieldCheck className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {filter === "all"
              ? "No messages in this session yet"
              : `No ${filter === "approvals" ? "approval prompts" : "tool usage"} captured yet`}
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-2">
        {messages.map((msg) => (
          <MessageRow
            key={msg.id}
            msg={msg}
            resolutionMap={resolutionMap}
            isExpanded={expandedId === msg.id}
            onToggle={() => toggleExpand(msg.id)}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// Content truncation + detail panel for expandable messages
// ---------------------------------------------------------------------------

const CONTENT_PREVIEW_LINES = 4;

function truncateContent(text: string): { preview: string; isTruncated: boolean } {
  const lines = text.split("\n");
  if (lines.length <= CONTENT_PREVIEW_LINES) return { preview: text, isTruncated: false };
  return { preview: lines.slice(0, CONTENT_PREVIEW_LINES).join("\n"), isTruncated: true };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MessageDetails({ msg, showFullContent }: { msg: MonitorMessage; showFullContent: boolean }) {
  const [copied, setCopied] = useState(false);
  const content = sanitizeText(msg.content);
  const lineCount = content.split("\n").length;
  const byteCount = new Blob([msg.content]).size;

  function handleCopy() {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="border-t border-border/50 mt-2 pt-2 space-y-2">
      {/* Full content (if was truncated) */}
      {showFullContent && (
        <div className="bg-muted/30 rounded p-2 max-h-96 overflow-auto">
          <pre className="text-xs text-foreground/90 font-mono whitespace-pre-wrap break-words">
            {content}
          </pre>
        </div>
      )}

      {/* Metadata grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        {msg.tool_name && (
          <>
            <span className="text-muted-foreground">Tool</span>
            <span className="font-mono text-foreground/80">{msg.tool_name}</span>
          </>
        )}
        {msg.tool_use_id && (
          <>
            <span className="text-muted-foreground">Tool ID</span>
            <span className="font-mono text-foreground/80 truncate" title={msg.tool_use_id}>
              {msg.tool_use_id.slice(0, 20)}...
            </span>
          </>
        )}
        {msg.permission_mode && (
          <>
            <span className="text-muted-foreground">Status</span>
            <span>
              <Badge
                variant="secondary"
                className={cn(
                  "text-[10px] px-1.5 py-0",
                  msg.permission_mode === "approved" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                  msg.permission_mode === "rejected" && "bg-red-500/10 text-red-700 dark:text-red-300",
                  msg.permission_mode === "pending" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                )}
              >
                {msg.permission_mode}
              </Badge>
            </span>
          </>
        )}
        <span className="text-muted-foreground">Seq</span>
        <span className="font-mono text-foreground/80">#{msg.seq}</span>

        <span className="text-muted-foreground">Captured</span>
        <span className="font-mono text-foreground/80">{msg.captured_at}</span>

        {msg.created_at && msg.created_at !== msg.captured_at && (
          <>
            <span className="text-muted-foreground">Received</span>
            <span className="font-mono text-foreground/80">{msg.created_at}</span>
          </>
        )}

        <span className="text-muted-foreground">Vendor</span>
        <span className="font-mono text-foreground/80">{msg.vendor}</span>

        <span className="text-muted-foreground">Size</span>
        <span className="font-mono text-foreground/80">{lineCount} lines, {formatBytes(byteCount)}</span>
      </div>

      {/* Copy button */}
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
          onClick={(e) => { e.stopPropagation(); handleCopy(); }}
        >
          <Copy className="w-3 h-3" />
          {copied ? "Copied!" : "Copy content"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MessageRow({
  msg,
  resolutionMap,
  isExpanded,
  onToggle,
}: {
  msg: MonitorMessage;
  resolutionMap: Map<string, MonitorMessage>;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const isPending = isPendingMessage(msg);
  const isApproval = isApprovalMessage(msg);
  const isTool = isToolMessage(msg);
  const { preview, isTruncated } = truncateContent(sanitizeText(msg.content));

  // Shared expand indicator shown in all collapsed message headers
  const expandHint = (
    <ChevronDown className={cn(
      "w-3 h-3 text-muted-foreground/50 transition-transform shrink-0",
      isExpanded && "rotate-180",
    )} />
  );

  // Pending tool request — check if resolved
  if (isPending) {
    const resolution = msg.tool_use_id ? resolutionMap.get(msg.tool_use_id) : undefined;
    const resolved = !!resolution;
    const approved = resolution?.permission_mode === "approved";

    if (resolved) {
      return (
        <Collapsible open={isExpanded} onOpenChange={onToggle}>
          <CollapsibleTrigger asChild>
            <div
              className={cn(
                "flex gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors",
                approved
                  ? "bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/10"
                  : "bg-red-500/5 border-red-500/20 hover:bg-red-500/10",
              )}
              data-testid={`msg-${msg.id}`}
            >
              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                  approved ? "bg-emerald-500/10" : "bg-red-500/10",
                )}
              >
                {approved ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={cn(
                      "text-xs font-medium",
                      approved
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-red-700 dark:text-red-300",
                    )}
                  >
                    {approved ? "Approved" : "Rejected"}
                  </span>
                  {msg.tool_name && (
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-[10px] gap-0.5 px-1.5 py-0",
                        approved
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "bg-red-500/10 text-red-700 dark:text-red-300",
                      )}
                    >
                      <Wrench className="w-2.5 h-2.5" />
                      {msg.tool_name}
                    </Badge>
                  )}
                  <span className="text-[11px] text-muted-foreground ml-auto shrink-0 flex items-center gap-1">
                    {formatTimestamp(msg.captured_at)}
                    {expandHint}
                  </span>
                </div>
                <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">
                  {isExpanded ? sanitizeText(msg.content) : preview}
                  {!isExpanded && isTruncated && <span className="text-muted-foreground"> ...</span>}
                </p>
              </div>
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="ml-10 mr-3 mb-1">
              <MessageDetails msg={msg} showFullContent={false} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      );
    }

    // Still pending — check if it's been pending a long time (likely still running)
    const pendingMs = Date.now() - new Date(msg.captured_at).getTime();
    const isStale = pendingMs > 5 * 60 * 1000; // >5 minutes

    return (
      <Collapsible open={isExpanded} onOpenChange={onToggle}>
        <CollapsibleTrigger asChild>
          <div
            className={cn(
              "flex gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors",
              isStale
                ? "bg-blue-500/5 border-blue-500/20 hover:bg-blue-500/10"
                : "bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10",
            )}
            data-testid={`msg-${msg.id}`}
          >
            <div className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
              isStale ? "bg-blue-500/10" : "bg-amber-500/10",
            )}>
              <Clock className={cn(
                "w-3.5 h-3.5",
                isStale
                  ? "text-blue-600 dark:text-blue-400 animate-pulse"
                  : "text-amber-600 dark:text-amber-400",
              )} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={cn(
                  "text-xs font-medium",
                  isStale
                    ? "text-blue-700 dark:text-blue-300"
                    : "text-amber-700 dark:text-amber-300",
                )}>
                  {isStale ? "Running..." : "Pending Approval"}
                </span>
                {msg.tool_name && (
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-[10px] gap-0.5 px-1.5 py-0",
                      isStale
                        ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
                        : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                    )}
                  >
                    <Wrench className="w-2.5 h-2.5" />
                    {msg.tool_name}
                  </Badge>
                )}
                <span className="text-[11px] text-muted-foreground ml-auto shrink-0 flex items-center gap-1">
                  {formatTimestamp(msg.captured_at)}
                  {expandHint}
                </span>
              </div>
              <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">
                {isExpanded ? sanitizeText(msg.content) : preview}
                {!isExpanded && isTruncated && <span className="text-muted-foreground"> ...</span>}
              </p>
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-10 mr-3 mb-1">
            <MessageDetails msg={msg} showFullContent={false} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // Approval events not linked to a pending message
  if (isApproval) {
    const approved = msg.permission_mode === "approved";
    return (
      <Collapsible open={isExpanded} onOpenChange={onToggle}>
        <CollapsibleTrigger asChild>
          <div
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors",
              approved
                ? "bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/10"
                : "bg-red-500/5 border-red-500/20 hover:bg-red-500/10",
            )}
            data-testid={`msg-${msg.id}`}
          >
            <div
              className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center shrink-0",
                approved ? "bg-emerald-500/10" : "bg-red-500/10",
              )}
            >
              {approved ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <span
                className={cn(
                  "text-xs font-medium",
                  approved
                    ? "text-emerald-700 dark:text-emerald-300"
                    : "text-red-700 dark:text-red-300",
                )}
              >
                {approved ? "Approved" : "Rejected"}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground shrink-0 flex items-center gap-1">
              {formatTimestamp(msg.captured_at)}
              {expandHint}
            </span>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-10 mr-3 mb-1">
            <MessageDetails msg={msg} showFullContent={!!msg.content.trim()} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // Tool use messages
  if (isTool) {
    return (
      <Collapsible open={isExpanded} onOpenChange={onToggle}>
        <CollapsibleTrigger asChild>
          <div
            className="flex gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors bg-orange-500/5 border-orange-500/20 hover:bg-orange-500/10"
            data-testid={`msg-${msg.id}`}
          >
            <div className="w-7 h-7 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <Wrench className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium">Tool Request</span>
                <Badge
                  variant="secondary"
                  className="text-[10px] gap-0.5 px-1.5 py-0 bg-orange-500/10 text-orange-700 dark:text-orange-300"
                >
                  <Wrench className="w-2.5 h-2.5" />
                  {msg.tool_name}
                </Badge>
                <span className="text-[11px] text-muted-foreground ml-auto shrink-0 flex items-center gap-1">
                  {formatTimestamp(msg.captured_at)}
                  {expandHint}
                </span>
              </div>
              <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">
                {isExpanded ? sanitizeText(msg.content) : preview}
                {!isExpanded && isTruncated && <span className="text-muted-foreground"> ...</span>}
              </p>
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-10 mr-3 mb-1">
            <MessageDetails msg={msg} showFullContent={false} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // Regular conversation messages
  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <div className="flex gap-3 px-3 py-2.5 cursor-pointer rounded-lg transition-colors hover:bg-muted/50" data-testid={`msg-${msg.id}`}>
          <div className="shrink-0 mt-0.5">
            {msg.role === "user" ? (
              <div className="w-7 h-7 rounded-full bg-blue-500/10 flex items-center justify-center">
                <User className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              </div>
            ) : (
              <div className="w-7 h-7 rounded-full bg-purple-500/10 flex items-center justify-center">
                <Bot className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium">
                {msg.role === "user" ? "You" : "Assistant"}
              </span>
              <span className="text-[11px] text-muted-foreground ml-auto shrink-0 flex items-center gap-1">
                {formatTimestamp(msg.captured_at)}
                {expandHint}
              </span>
            </div>
            <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">
              {isExpanded ? sanitizeText(msg.content) : preview}
              {!isExpanded && isTruncated && <span className="text-muted-foreground"> ...</span>}
            </p>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-10 mr-3 mb-1">
          <MessageDetails msg={msg} showFullContent={isTruncated} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Hook approval banner — live tool approval requests from Claude Code
// ---------------------------------------------------------------------------

/** Render full tool input details like Claude Code's approval prompt. */
function ToolInputDetails({ toolName, toolInput }: { toolName: string; toolInput: string }) {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(toolInput);
  } catch {
    return <pre className="text-xs text-foreground/80 font-mono whitespace-pre-wrap break-all bg-muted/50 rounded p-2 mt-1.5 max-h-64 overflow-auto">{toolInput}</pre>;
  }

  if (toolName === "Bash") {
    const cmd = (parsed.command as string) || "";
    const desc = (parsed.description as string) || "";
    return (
      <div className="mt-1.5 space-y-1">
        {desc && <p className="text-xs text-muted-foreground italic">{desc}</p>}
        <pre className="text-xs text-foreground/80 font-mono whitespace-pre-wrap break-all bg-muted/50 rounded p-2 max-h-64 overflow-auto">$ {cmd}</pre>
      </div>
    );
  }

  if (toolName === "Edit") {
    const fp = (parsed.file_path as string) || "";
    const old_s = (parsed.old_string as string) || "";
    const new_s = (parsed.new_string as string) || "";
    return (
      <div className="mt-1.5 space-y-1">
        <p className="text-xs font-mono text-muted-foreground">{fp}</p>
        {old_s && (
          <div className="bg-muted/50 rounded p-2 max-h-48 overflow-auto">
            <div className="text-xs font-mono">
              {old_s.split("\n").map((line, i) => (
                <div key={`o${i}`} className="text-red-600/80 dark:text-red-400/80">- {line}</div>
              ))}
              {new_s.split("\n").map((line, i) => (
                <div key={`n${i}`} className="text-emerald-600/80 dark:text-emerald-400/80">+ {line}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (toolName === "Write") {
    const fp = (parsed.file_path as string) || "";
    const content = (parsed.content as string) || "";
    const preview = content.length > 500 ? content.slice(0, 500) + "\n..." : content;
    return (
      <div className="mt-1.5 space-y-1">
        <p className="text-xs font-mono text-muted-foreground">{fp}</p>
        <pre className="text-xs text-foreground/80 font-mono whitespace-pre-wrap break-all bg-muted/50 rounded p-2 max-h-48 overflow-auto">{preview}</pre>
      </div>
    );
  }

  if (toolName === "Read" || toolName === "Glob" || toolName === "Grep") {
    const fp = (parsed.file_path as string) || (parsed.path as string) || (parsed.pattern as string) || "";
    return (
      <div className="mt-1.5">
        <pre className="text-xs text-foreground/80 font-mono whitespace-pre-wrap bg-muted/50 rounded p-2">{fp}</pre>
      </div>
    );
  }

  if (toolName === "Task" || toolName === "Agent") {
    const desc = (parsed.description as string) || "";
    const prompt = (parsed.prompt as string) || "";
    return (
      <div className="mt-1.5 space-y-1">
        {desc && <p className="text-xs font-medium text-foreground/80">{desc}</p>}
        {prompt && <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all bg-muted/50 rounded p-2 max-h-32 overflow-auto">{prompt.slice(0, 300)}{prompt.length > 300 ? "..." : ""}</pre>}
      </div>
    );
  }

  // Generic fallback — show all fields
  const entries = Object.entries(parsed).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return null;
  return (
    <div className="mt-1.5">
      <pre className="text-xs text-foreground/80 font-mono whitespace-pre-wrap break-all bg-muted/50 rounded p-2 max-h-48 overflow-auto">
        {entries.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n")}
      </pre>
    </div>
  );
}

/** Parse AskUserQuestion tool_input into structured questions. */
interface ParsedQuestion {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect: boolean;
}

function parseAskUserQuestions(toolInput: string): ParsedQuestion[] | null {
  try {
    const parsed = JSON.parse(toolInput);
    const questions = parsed.questions;
    if (!Array.isArray(questions) || questions.length === 0) return null;
    return questions.map((q: any) => ({
      question: q.question ?? "",
      header: q.header,
      options: Array.isArray(q.options) ? q.options.map((o: any) => ({
        label: typeof o === "string" ? o : (o.label ?? ""),
        description: o.description,
      })) : [],
      multiSelect: q.multiSelect === true,
    }));
  } catch {
    return null;
  }
}

/** Build the "Always Allow" rule string for Claude Code settings.json */
function buildAlwaysAllowRule(toolName: string, toolInput: string): string | null {
  try {
    const parsed = JSON.parse(toolInput);
    if (toolName === "Bash" && parsed.command) {
      // Allow the exact command
      return `Bash(${parsed.command})`;
    }
    if ((toolName === "Read" || toolName === "Glob" || toolName === "Grep") && (parsed.file_path || parsed.path || parsed.pattern)) {
      return `${toolName}(${parsed.file_path || parsed.path || parsed.pattern})`;
    }
    if ((toolName === "Edit" || toolName === "Write") && parsed.file_path) {
      return `${toolName}(${parsed.file_path})`;
    }
  } catch { /* ignore */ }
  return null;
}

/** Single approval card for AskUserQuestion — renders selectable questions/options. */
function AskUserQuestionCard({
  approval,
  questions,
  onDecide,
  isPending,
}: {
  approval: HookApproval;
  questions: ParsedQuestion[];
  onDecide: (id: string, decision: "allow" | "deny", opts?: { updatedInput?: Record<string, unknown> }) => void;
  isPending: boolean;
}) {
  // Track selected answers per question: { questionText: "selected label" | "selected labels" }
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({});

  const allAnswered = questions.every((q) => {
    const a = answers[q.question];
    if (!a) return false;
    if (Array.isArray(a)) return a.length > 0;
    return a.length > 0;
  });

  function handleSubmit() {
    // Build the answers map: { questionText: "selected label" }
    const answerMap: Record<string, string> = {};
    for (const q of questions) {
      const a = answers[q.question];
      if (a === "__other__") {
        answerMap[q.question] = customTexts[q.question] || "";
      } else if (Array.isArray(a)) {
        answerMap[q.question] = a.filter((x) => x !== "__other__").join(", ") +
          (a.includes("__other__") && customTexts[q.question] ? `, ${customTexts[q.question]}` : "");
      } else {
        answerMap[q.question] = a ?? "";
      }
    }
    onDecide(approval.id, "allow", { updatedInput: { answers: answerMap } });
  }

  return (
    <div className="rounded-lg border border-blue-500/20 bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-blue-500/10">
        <div className="w-7 h-7 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
          <HelpCircle className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
            Claude is asking {questions.length > 1 ? `${questions.length} questions` : "a question"}
          </span>
          {approval.cwd && (
            <span className="text-[10px] text-muted-foreground font-mono ml-2 truncate">
              {approval.cwd.split("/").slice(-2).join("/")}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1 border-red-500/30 text-red-700 dark:text-red-300 hover:bg-red-500/10"
          onClick={() => onDecide(approval.id, "deny")}
          disabled={isPending}
        >
          <XCircle className="w-3 h-3" />
          Dismiss
        </Button>
      </div>

      {/* Questions */}
      <div className="px-3 py-2.5 space-y-3">
        {questions.map((q, qi) => (
          <div key={qi} className="space-y-1.5">
            {q.header && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 mb-0.5">{q.header}</Badge>
            )}
            <p className="text-xs font-medium text-foreground">{q.question}</p>
            <div className="space-y-1">
              {q.options.map((opt, oi) => {
                const isSelected = q.multiSelect
                  ? (Array.isArray(answers[q.question]) && (answers[q.question] as string[]).includes(opt.label))
                  : answers[q.question] === opt.label;

                function toggle() {
                  if (q.multiSelect) {
                    setAnswers((prev) => {
                      const current = Array.isArray(prev[q.question]) ? [...(prev[q.question] as string[])] : [];
                      const idx = current.indexOf(opt.label);
                      if (idx >= 0) current.splice(idx, 1);
                      else current.push(opt.label);
                      return { ...prev, [q.question]: current };
                    });
                  } else {
                    setAnswers((prev) => ({ ...prev, [q.question]: opt.label }));
                  }
                }

                return (
                  <button
                    key={oi}
                    onClick={toggle}
                    className={cn(
                      "w-full text-left rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                      isSelected
                        ? "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                        : "border-border hover:border-blue-500/40 hover:bg-blue-500/5 text-foreground",
                    )}
                  >
                    <span className="font-medium">{opt.label}</span>
                    {opt.description && (
                      <span className="text-muted-foreground ml-1.5">— {opt.description}</span>
                    )}
                  </button>
                );
              })}
              {/* "Other" option — always available */}
              {(() => {
                const isOtherSelected = q.multiSelect
                  ? (Array.isArray(answers[q.question]) && (answers[q.question] as string[]).includes("__other__"))
                  : answers[q.question] === "__other__";
                return (
                  <div className="space-y-1">
                    <button
                      onClick={() => {
                        if (q.multiSelect) {
                          setAnswers((prev) => {
                            const current = Array.isArray(prev[q.question]) ? [...(prev[q.question] as string[])] : [];
                            const idx = current.indexOf("__other__");
                            if (idx >= 0) current.splice(idx, 1);
                            else current.push("__other__");
                            return { ...prev, [q.question]: current };
                          });
                        } else {
                          setAnswers((prev) => ({ ...prev, [q.question]: "__other__" }));
                        }
                      }}
                      className={cn(
                        "w-full text-left rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                        isOtherSelected
                          ? "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                          : "border-border hover:border-blue-500/40 hover:bg-blue-500/5 text-foreground",
                      )}
                    >
                      <span className="font-medium">Other</span>
                      <span className="text-muted-foreground ml-1.5">— provide custom text</span>
                    </button>
                    {isOtherSelected && (
                      <Input
                        autoFocus
                        className="h-7 text-xs"
                        placeholder="Type your answer..."
                        value={customTexts[q.question] ?? ""}
                        onChange={(e) => setCustomTexts((prev) => ({ ...prev, [q.question]: e.target.value }))}
                      />
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        ))}
      </div>

      {/* Submit */}
      <div className="px-3 pb-2.5 flex justify-end">
        <Button
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={handleSubmit}
          disabled={!allAnswered || isPending}
        >
          <Send className="w-3 h-3" />
          Submit
        </Button>
      </div>
    </div>
  );
}

/** Single approval card for regular tools — Allow / Always Allow / Deny. */
function ToolApprovalCard({
  approval,
  onDecide,
  isPending,
}: {
  approval: HookApproval;
  onDecide: (id: string, decision: "allow" | "deny", opts?: { alwaysAllow?: string }) => void;
  isPending: boolean;
}) {
  const alwaysAllowRule = buildAlwaysAllowRule(approval.tool_name, approval.tool_input);

  return (
    <div className="rounded-lg border border-amber-500/20 bg-background overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="w-7 h-7 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
          <Wrench className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className="text-[10px] gap-0.5 px-1.5 py-0 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            >
              <Wrench className="w-2.5 h-2.5" />
              {approval.tool_name}
            </Badge>
            {approval.cwd && (
              <span className="text-[10px] text-muted-foreground font-mono truncate">
                {approval.cwd.split("/").slice(-2).join("/")}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
            onClick={() => onDecide(approval.id, "allow")}
            disabled={isPending}
          >
            <CheckCircle2 className="w-3 h-3" />
            Allow
          </Button>
          {alwaysAllowRule && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 border-blue-500/30 text-blue-700 dark:text-blue-300 hover:bg-blue-500/10"
              onClick={() => onDecide(approval.id, "allow", { alwaysAllow: alwaysAllowRule })}
              disabled={isPending}
            >
              <ShieldCheck className="w-3 h-3" />
              Always Allow
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1 border-red-500/30 text-red-700 dark:text-red-300 hover:bg-red-500/10"
            onClick={() => onDecide(approval.id, "deny")}
            disabled={isPending}
          >
            <XCircle className="w-3 h-3" />
            Deny
          </Button>
        </div>
      </div>
      {/* Full tool input details */}
      <div className="px-3 pb-2.5 pt-0 ml-10">
        <ToolInputDetails toolName={approval.tool_name} toolInput={approval.tool_input} />
      </div>
    </div>
  );
}

function HookApprovalBanner() {
  const queryClient = useQueryClient();

  const { data: pendingApprovals } = useQuery<HookApproval[]>({
    queryKey: ["/api/hook/pending"],
    refetchInterval: 5000, // Fallback polling; primary updates via WebSocket
  });

  // Real-time WebSocket for instant approval notifications
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/events`);
    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === "hook:pending" || event.type === "hook:decided") {
          queryClient.invalidateQueries({ queryKey: ["/api/hook/pending"] });
        }
      } catch { /* ignore parse errors */ }
    };
    return () => ws.close();
  }, [queryClient]);

  const decideMutation = useMutation({
    mutationFn: async ({
      id,
      decision,
      updatedInput,
      alwaysAllow,
    }: {
      id: string;
      decision: "allow" | "deny";
      updatedInput?: Record<string, unknown>;
      alwaysAllow?: string;
    }) => {
      const res = await fetch(`/api/hook/decide/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, updatedInput, alwaysAllow }),
      });
      if (!res.ok) throw new Error("Failed to submit decision");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hook/pending"] });
    },
  });

  if (!pendingApprovals || pendingApprovals.length === 0) return null;

  function handleDecide(
    id: string,
    decision: "allow" | "deny",
    opts?: { updatedInput?: Record<string, unknown>; alwaysAllow?: string },
  ) {
    decideMutation.mutate({ id, decision, ...opts });
  }

  return (
    <div className="border-b bg-amber-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 animate-pulse" />
        <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
          {pendingApprovals.length} approval{pendingApprovals.length !== 1 ? "s" : ""} waiting
        </span>
      </div>
      {pendingApprovals.map((approval) => {
        // Detect AskUserQuestion — render with selectable options
        if (approval.tool_name === "AskUserQuestion") {
          const questions = parseAskUserQuestions(approval.tool_input);
          if (questions) {
            return (
              <AskUserQuestionCard
                key={approval.id}
                approval={approval}
                questions={questions}
                onDecide={handleDecide}
                isPending={decideMutation.isPending}
              />
            );
          }
        }
        // All other tools — standard Allow / Always Allow / Deny
        return (
          <ToolApprovalCard
            key={approval.id}
            approval={approval}
            onDecide={handleDecide}
            isPending={decideMutation.isPending}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page — two-panel layout
// ---------------------------------------------------------------------------

export default function PromptsPage() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [filter, setFilter] = useState<ViewFilter>("approvals");

  const { data: sessions, isLoading: sessionsLoading } =
    useQuery<MonitorSessionWithCounts[]>({
      queryKey: ["/api/monitor/sessions-with-counts"],
      refetchInterval: 5000,
    });

  // Auto-select the most recent session on first load
  useEffect(() => {
    if (!selectedSessionId && sessions && sessions.length > 0) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [sessions, selectedSessionId]);

  const sessionList = sessions ?? [];

  // Count distinct workspaces using workspace_key for accuracy
  const workspaceCount = new Set(
    sessionList.map((s) => s.workspace_key ?? s.conversation_id),
  ).size;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-muted-foreground" />
            Prompts
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {workspaceCount > 0
              ? `${workspaceCount} workspace${workspaceCount !== 1 ? "s" : ""} monitored`
              : "Tool approvals and conversations captured from Claude Code sessions"}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
          <Button
            variant={filter === "approvals" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setFilter("approvals")}
            data-testid="filter-approvals"
          >
            <Filter className="w-3 h-3" />
            Approvals
          </Button>
          <Button
            variant={filter === "tools" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setFilter("tools")}
            data-testid="filter-tools"
          >
            <Wrench className="w-3 h-3" />
            Tools
          </Button>
          <Button
            variant={filter === "all" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setFilter("all")}
            data-testid="filter-all"
          >
            All
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex h-[calc(100vh-12rem)] min-h-[400px]">
          {/* Left panel — session list */}
          <div className="w-72 border-r shrink-0 flex flex-col">
            <SessionList
              sessions={sessionList}
              selectedId={selectedSessionId}
              onSelect={setSelectedSessionId}
              isLoading={sessionsLoading}
            />
          </div>

          {/* Right panel — hook approvals + message thread */}
          <div className="flex-1 flex flex-col min-w-0">
            <HookApprovalBanner />
            <MessageThread sessionId={selectedSessionId} filter={filter} />
          </div>
        </div>
      </Card>
    </div>
  );
}
