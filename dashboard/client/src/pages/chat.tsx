import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Session, TranscriptChunk } from "@shared/schema";
import { Bot, Clock, MessageSquare, Send, User, Terminal } from "lucide-react";

interface PendingPrompt {
  id: string;
  excerpt: string;
  prompt_type: string;
  confidence: string;
  created_at: string;
  session_id: string;
}

const SESSIONS_QUERY_KEY = ["/api/sessions"];

function ago(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function chunkStyle(role: string): string {
  switch (role) {
    case "user":
      return "bg-blue-500/5 border-l-2 border-blue-500/30";
    case "operator":
      return "bg-amber-500/5 border-l-2 border-amber-500/30";
    default:
      return "bg-muted/30";
  }
}

function chunkIcon(role: string) {
  switch (role) {
    case "user":
      return <User className="w-3 h-3 text-blue-500" />;
    case "operator":
      return <MessageSquare className="w-3 h-3 text-amber-500" />;
    default:
      return <Bot className="w-3 h-3 text-muted-foreground" />;
  }
}

function chunkLabel(role: string): string {
  switch (role) {
    case "user":
      return "Reply";
    case "operator":
      return "Operator";
    default:
      return "Agent";
  }
}

export default function ChatPage() {
  const { toast } = useToast();
  const searchString = useSearch();
  const [selectedSession, setSelectedSession] = useState<string>("");
  const [replyValues, setReplyValues] = useState<Record<string, string>>({});
  const [messageText, setMessageText] = useState("");
  const [transcriptChunks, setTranscriptChunks] = useState<TranscriptChunk[]>([]);
  const [lastSeq, setLastSeq] = useState(0);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const { data: sessions, isLoading: sessionsLoading } = useQuery<Session[]>({
    queryKey: SESSIONS_QUERY_KEY,
    refetchInterval: 5_000,
  });

  const activeSessions = (sessions ?? []).filter((s) => s.status === "running");

  // Auto-select session from URL param (e.g. /chat?sessionId=abc123)
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const sid = params.get("sessionId");
    if (sid && !selectedSession && activeSessions.length > 0) {
      const match = activeSessions.find((s) => s.id === sid || s.id.startsWith(sid));
      if (match) setSelectedSession(match.id);
    }
  }, [searchString, activeSessions, selectedSession]);

  // Reset transcript when session changes
  useEffect(() => {
    setTranscriptChunks([]);
    setLastSeq(0);
    setMessageText("");
  }, [selectedSession]);

  // Poll for new transcript chunks
  const { data: newChunks } = useQuery<TranscriptChunk[]>({
    queryKey: ["/api/sessions", selectedSession, "transcript", lastSeq],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/sessions/${encodeURIComponent(selectedSession)}/transcript?after_seq=${lastSeq}`,
      ).then((r) => r.json()),
    enabled: Boolean(selectedSession),
    refetchInterval: 2_500,
  });

  useEffect(() => {
    if (newChunks && newChunks.length > 0) {
      setTranscriptChunks((prev) => [...prev, ...newChunks]);
      setLastSeq(newChunks[newChunks.length - 1].seq);
    }
  }, [newChunks]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcriptChunks]);

  const promptsQueryKey = ["/api/chat/prompts", selectedSession];
  const { data: prompts, isLoading: promptsLoading } = useQuery<PendingPrompt[]>({
    queryKey: promptsQueryKey,
    queryFn: () =>
      apiRequest("GET", `/api/chat/prompts?session_id=${encodeURIComponent(selectedSession)}`)
        .then((r) => r.json()),
    enabled: Boolean(selectedSession),
    refetchInterval: 3_000,
  });

  const replyMutation = useMutation({
    mutationFn: (vars: { prompt_id: string; value: string }) =>
      apiRequest("POST", "/api/chat/reply", {
        session_id: selectedSession,
        prompt_id: vars.prompt_id,
        value: vars.value,
      }),
    onSuccess: (_data, vars) => {
      toast({ title: "Reply sent" });
      setReplyValues((p) => { const n = { ...p }; delete n[vars.prompt_id]; return n; });
      queryClient.invalidateQueries({ queryKey: promptsQueryKey });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const messageMutation = useMutation({
    mutationFn: (text: string) =>
      apiRequest("POST", `/api/sessions/${encodeURIComponent(selectedSession)}/message`, { text }),
    onSuccess: (_data, text) => {
      // Optimistic: immediately show the operator message in the transcript
      const optimisticChunk: TranscriptChunk = {
        id: Date.now(),
        seq: lastSeq + 0.5, // fractional seq so it sorts before next real chunk
        session_id: selectedSession,
        role: "operator",
        content: text,
        created_at: new Date().toISOString(),
        prompt_id: null,
      };
      setTranscriptChunks((prev) => [...prev, optimisticChunk]);
      toast({ title: "Message sent" });
      setMessageText("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleReply = (promptId: string) => {
    const value = replyValues[promptId]?.trim();
    if (!value) return;
    replyMutation.mutate({ prompt_id: promptId, value });
  };

  const handleSendMessage = () => {
    const text = messageText.trim();
    if (!text) return;
    messageMutation.mutate(text);
  };

  const confidenceBadgeCls = (conf: string) => {
    switch (conf.toLowerCase()) {
      case "high": return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
      case "medium": return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
      default: return "bg-red-500/10 text-red-700 dark:text-red-300";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <Bot className="w-5 h-5 text-muted-foreground" />
          Chat
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live session transcript and prompt relay.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Active session</CardTitle>
        </CardHeader>
        <CardContent>
          {sessionsLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : activeSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active sessions. Start one with{" "}
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">atlasbridge run claude</code>
              {" "}or from the Sessions page.
            </p>
          ) : (
            <Select value={selectedSession} onValueChange={setSelectedSession}>
              <SelectTrigger data-testid="select-chat-session">
                <SelectValue placeholder="Select a session…" />
              </SelectTrigger>
              <SelectContent>
                {activeSessions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="font-mono text-xs">{s.id.slice(0, 8)}</span>
                    <span className="ml-2 text-muted-foreground">{s.tool}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {selectedSession && (
        <>
          {/* Live Transcript */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Terminal className="w-4 h-4" />
                Live Transcript
                {transcriptChunks.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] ml-auto">
                    {transcriptChunks.length} chunks
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div
                className="max-h-[400px] overflow-y-auto"
                data-testid="transcript-container"
              >
                {transcriptChunks.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    Waiting for session output...
                  </div>
                ) : (
                  <div className="divide-y">
                    {transcriptChunks.map((chunk) => (
                      <div
                        key={chunk.seq}
                        className={`px-4 py-2 ${chunkStyle(chunk.role)}`}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          {chunkIcon(chunk.role)}
                          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            {chunkLabel(chunk.role)}
                          </span>
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {ago(chunk.created_at)}
                          </span>
                        </div>
                        <pre className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-foreground/90">
                          {chunk.content}
                        </pre>
                      </div>
                    ))}
                    <div ref={transcriptEndRef} />
                  </div>
                )}
              </div>

              {/* Operator message input */}
              <div className="flex gap-2 p-3 border-t" data-testid="message-input-bar">
                <Input
                  placeholder="Send a message to the agent…"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                  disabled={messageMutation.isPending}
                  data-testid="input-message"
                  className="font-mono text-sm"
                />
                <Button
                  size="sm"
                  onClick={handleSendMessage}
                  disabled={!messageText.trim() || messageMutation.isPending}
                  data-testid="button-send-message"
                >
                  <Send className="w-3.5 h-3.5 mr-1" />
                  {messageMutation.isPending ? "Sending…" : "Send"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Pending Prompts */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Pending prompts</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {promptsLoading ? (
                <div className="p-4 space-y-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : !prompts || prompts.length === 0 ? (
                <div
                  className="p-6 text-center text-sm text-muted-foreground"
                  data-testid="text-no-prompts"
                >
                  No pending prompts. The agent will appear here when it needs a decision.
                </div>
              ) : (
                <div className="divide-y" data-testid="prompt-list">
                  {prompts.map((prompt) => (
                    <div
                      key={prompt.id}
                      className="p-4 space-y-3"
                      data-testid={`prompt-row-${prompt.id}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary" className="text-[10px] font-mono">
                            {prompt.prompt_type}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className={`text-[10px] ${confidenceBadgeCls(prompt.confidence)}`}
                          >
                            {prompt.confidence}
                          </Badge>
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            {ago(prompt.created_at)}
                          </span>
                        </div>
                        <code className="text-[10px] text-muted-foreground font-mono shrink-0">
                          {prompt.id.slice(0, 8)}
                        </code>
                      </div>

                      <pre className="text-sm font-mono bg-muted/50 rounded p-3 whitespace-pre-wrap break-words leading-relaxed">
                        {prompt.excerpt || "(no excerpt)"}
                      </pre>

                      <div className="flex gap-2">
                        <Input
                          placeholder="Type your reply…"
                          value={replyValues[prompt.id] ?? ""}
                          onChange={(e) =>
                            setReplyValues((p) => ({ ...p, [prompt.id]: e.target.value }))
                          }
                          onKeyDown={(e) => e.key === "Enter" && handleReply(prompt.id)}
                          data-testid={`input-reply-${prompt.id}`}
                          className="font-mono text-sm"
                        />
                        <Button
                          size="sm"
                          onClick={() => handleReply(prompt.id)}
                          disabled={!replyValues[prompt.id]?.trim() || replyMutation.isPending}
                          data-testid={`button-reply-${prompt.id}`}
                        >
                          <Send className="w-3.5 h-3.5 mr-1" />
                          {replyMutation.isPending ? "Sending…" : "Send"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
