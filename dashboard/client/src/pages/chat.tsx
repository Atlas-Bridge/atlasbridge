import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Session, AgentTurn } from "@shared/schema";
import { Bot, Send, Loader2, Play, Settings, KeyRound, User } from "lucide-react";

interface ProviderInfo {
  provider: string;
  status: string;
  key_prefix: string | null;
}

function ago(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  google: "Google (Gemini)",
};

export default function ChatPage() {
  const { toast } = useToast();
  const [selectedSession, setSelectedSession] = useState<string>("");
  const [message, setMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Check configured providers
  const { data: providers, isLoading: providersLoading } = useQuery<ProviderInfo[]>({
    queryKey: ["/api/providers"],
    refetchInterval: 30_000,
  });

  const configuredProviders = (providers ?? []).filter(
    (p) => p.status === "validated" || p.status === "configured",
  );

  // Fetch agent sessions
  const { data: sessions } = useQuery<Session[]>({
    queryKey: ["/api/sessions"],
    refetchInterval: 5_000,
  });

  const agentSessions = (sessions ?? []).filter((s) => s.tool?.startsWith("agent"));
  const activeAgentSessions = agentSessions.filter((s) => s.status === "running");

  // Auto-select most recent active agent session
  useEffect(() => {
    if (!selectedSession && activeAgentSessions.length > 0) {
      setSelectedSession(activeAgentSessions[0].id);
    }
  }, [activeAgentSessions, selectedSession]);

  // Fetch conversation turns for selected session
  const { data: turns } = useQuery<AgentTurn[]>({
    queryKey: [`/api/agent/sessions/${selectedSession}/turns`],
    refetchInterval: 2_000,
    enabled: Boolean(selectedSession),
  });

  // Auto-scroll on new turns
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns?.length]);

  // Start a new agent session
  const startMutation = useMutation({
    mutationFn: async (provider: string) => {
      const resp = await apiRequest("POST", "/api/agent/start", { provider });
      const ct = resp.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        throw new Error("Server returned unexpected response.");
      }
      const data = await resp.json();
      if (!data.session_id) {
        throw new Error(data.error || "Failed to start agent session.");
      }
      return data as { ok: boolean; session_id: string };
    },
    onSuccess: (data) => {
      setSelectedSession(data.session_id);
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
    },
    onError: (e: Error) =>
      toast({ title: "Failed to start chat", description: e.message, variant: "destructive" }),
  });

  // Send a message
  const sendMutation = useMutation({
    mutationFn: (text: string) =>
      apiRequest("POST", `/api/agent/sessions/${selectedSession}/message`, { text }),
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: [`/api/agent/sessions/${selectedSession}/turns`] });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleSend = () => {
    const text = message.trim();
    if (!text || !selectedSession) return;
    sendMutation.mutate(text);
  };

  const handleStartChat = (provider: string) => {
    if (startMutation.isPending) return;
    startMutation.mutate(provider);
  };

  // Loading state
  if (providersLoading) {
    return (
      <div className="space-y-6">
        <ChatHeader />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  // No providers configured — show setup prompt
  if (configuredProviders.length === 0) {
    return (
      <div className="space-y-6">
        <ChatHeader />
        <Card>
          <CardContent className="py-12">
            <div className="text-center space-y-4 max-w-md mx-auto">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
                <KeyRound className="w-6 h-6 text-muted-foreground" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Configure an AI provider</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  To chat with an AI agent, add an API key for at least one provider.
                </p>
              </div>
              <div className="space-y-2 text-left">
                {["anthropic", "openai", "google"].map((p) => (
                  <div
                    key={p}
                    className="flex items-center justify-between border rounded-lg px-4 py-3"
                  >
                    <div>
                      <span className="text-sm font-medium">{PROVIDER_LABELS[p]}</span>
                      <p className="text-xs text-muted-foreground">Not configured</p>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      missing
                    </Badge>
                  </div>
                ))}
              </div>
              <Link href="/settings">
                <Button className="mt-2" data-testid="button-configure-providers">
                  <Settings className="w-4 h-4 mr-2" />
                  Go to Settings
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Providers configured but no active session — offer to start one
  if (!selectedSession) {
    return (
      <div className="space-y-6">
        <ChatHeader />
        <Card>
          <CardContent className="py-12">
            <div className="text-center space-y-4 max-w-md mx-auto">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
                <Bot className="w-6 h-6 text-muted-foreground" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Start a conversation</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Choose an AI provider to begin chatting.
                </p>
              </div>
              <div className="space-y-2">
                {configuredProviders.map((p) => (
                  <Button
                    key={p.provider}
                    variant="outline"
                    className="w-full justify-between h-auto py-3"
                    onClick={() => handleStartChat(p.provider)}
                    disabled={startMutation.isPending}
                    data-testid={`button-start-${p.provider}`}
                  >
                    <div className="text-left">
                      <span className="text-sm font-medium">
                        {PROVIDER_LABELS[p.provider] || p.provider}
                      </span>
                      {p.key_prefix && (
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">
                          {p.key_prefix}...
                        </p>
                      )}
                    </div>
                    {startMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                  </Button>
                ))}
              </div>
              {agentSessions.length > 0 && (
                <div className="pt-2">
                  <p className="text-xs text-muted-foreground mb-2">Or resume an existing session:</p>
                  <Select value="" onValueChange={setSelectedSession}>
                    <SelectTrigger data-testid="select-resume-session">
                      <SelectValue placeholder="Select a session..." />
                    </SelectTrigger>
                    <SelectContent>
                      {agentSessions.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          <span className="font-mono text-xs">{s.id.slice(0, 8)}</span>
                          <span className="ml-2 text-muted-foreground">{s.status}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Active chat session
  return (
    <div className="space-y-4" data-testid="chat-page">
      <div className="flex items-center justify-between gap-4">
        <ChatHeader />
        <div className="flex items-center gap-2">
          {activeAgentSessions.length > 1 && (
            <Select value={selectedSession} onValueChange={setSelectedSession}>
              <SelectTrigger className="w-[180px] h-8 text-xs" data-testid="select-chat-session">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {activeAgentSessions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="font-mono">{s.id.slice(0, 8)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => setSelectedSession("")}
            data-testid="button-new-chat"
          >
            New Chat
          </Button>
        </div>
      </div>

      <Card className="flex flex-col" style={{ minHeight: "70vh" }}>
        <ScrollArea className="flex-1 px-4" ref={scrollRef}>
          <div className="space-y-4 py-4" data-testid="chat-messages">
            {(!turns || turns.length === 0) ? (
              <div className="text-center py-16 text-sm text-muted-foreground">
                <Bot className="w-8 h-8 mx-auto mb-3 opacity-30" />
                Send a message to start the conversation.
              </div>
            ) : (
              turns.map((turn) => (
                <ChatBubble key={turn.id} turn={turn} />
              ))
            )}
          </div>
        </ScrollArea>

        <div className="p-4 border-t shrink-0">
          <div className="flex gap-2">
            <Input
              placeholder="Type a message..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              disabled={sendMutation.isPending}
              data-testid="input-chat-message"
              className="text-sm"
            />
            <Button
              onClick={handleSend}
              disabled={!message.trim() || sendMutation.isPending}
              data-testid="button-chat-send"
            >
              {sendMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ChatHeader() {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
        <Bot className="w-5 h-5 text-muted-foreground" />
        Chat
      </h1>
      <p className="text-sm text-muted-foreground mt-1">
        Talk to an AI agent powered by your configured provider.
      </p>
    </div>
  );
}

function ChatBubble({ turn }: { turn: AgentTurn }) {
  const isUser = turn.role === "user";
  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
      data-testid={`chat-turn-${turn.id}`}
    >
      <div className={`max-w-[80%] space-y-1`}>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {isUser ? (
            <User className="w-3 h-3" />
          ) : (
            <Bot className="w-3 h-3" />
          )}
          <span className="font-medium">{isUser ? "You" : "Agent"}</span>
          <span>{ago(turn.created_at)}</span>
        </div>
        <div
          className={`rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap break-words leading-relaxed ${
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted/50 border"
          }`}
        >
          {turn.content || (
            <span className="flex items-center gap-2 text-muted-foreground italic">
              <Loader2 className="w-3 h-3 animate-spin" />
              Thinking...
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
