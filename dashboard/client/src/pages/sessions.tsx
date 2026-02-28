import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import type { Session, MonitorSession, MonitorMessage } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { riskBg, statusColor, ciColor, formatTimestamp, timeAgo } from "@/lib/utils";
import {
  Search, ExternalLink, Play, Square, Pause, Radio, MessageSquare, Layers,
  Globe, Monitor, Code2, User, Bot, X, Loader2, Activity,
} from "lucide-react";

const ACTIVE_STATUSES = new Set(["starting", "running", "awaiting_reply"]);
const PAUSABLE_STATUSES = new Set(["running", "awaiting_reply"]);

// ---------------------------------------------------------------------------
// Vendor metadata for monitored sessions
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Start Session Dialog
// ---------------------------------------------------------------------------

function StartSessionDialog({
  open,
  onOpenChange,
  onSessionStarted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSessionStarted?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [adapter, setAdapter] = useState("claude");
  const [mode, setMode] = useState("off");
  const [cwd, setCwd] = useState("");
  const [label, setLabel] = useState("");
  const [customCommand, setCustomCommand] = useState("");

  const startMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/sessions/start", {
        adapter,
        mode,
        cwd: cwd || undefined,
        label: label || undefined,
        ...(adapter === "custom" ? { customCommand } : {}),
      }),
    onSuccess: () => {
      toast({ title: "Session started", description: `${adapter === "custom" ? customCommand.split(" ")[0] : adapter} (${mode}) session launched.` });
      qc.refetchQueries({ queryKey: ["/api/sessions"] });
      setTimeout(() => qc.refetchQueries({ queryKey: ["/api/sessions"] }), 1500);
      setTimeout(() => qc.refetchQueries({ queryKey: ["/api/sessions"] }), 3000);
      onOpenChange(false);
      onSessionStarted?.();
      setAdapter("claude");
      setMode("off");
      setCwd("");
      setLabel("");
      setCustomCommand("");
    },
    onError: (e: Error) =>
      toast({ title: "Failed to start session", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-start-session">
        <DialogHeader>
          <DialogTitle>Start Session</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="adapter-select" className="text-xs text-muted-foreground">Adapter</Label>
            <Select value={adapter} onValueChange={v => { setAdapter(v); setCustomCommand(""); }}>
              <SelectTrigger id="adapter-select" data-testid="select-adapter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude">Claude Code</SelectItem>
                <SelectItem value="claude-code">Claude Code (alias)</SelectItem>
                <SelectItem value="openai">OpenAI CLI</SelectItem>
                <SelectItem value="gemini">Gemini CLI</SelectItem>
                <SelectItem value="custom">Custom (any tool)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {adapter === "custom" && (
            <div className="space-y-1.5">
              <Label htmlFor="custom-command-input" className="text-xs text-muted-foreground">
                Command
              </Label>
              <Input
                id="custom-command-input"
                placeholder="e.g. cursor, aider --model gpt-4o"
                value={customCommand}
                onChange={e => setCustomCommand(e.target.value)}
                data-testid="input-custom-command"
                className="font-mono text-sm"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="mode-select" className="text-xs text-muted-foreground">Autonomy Mode</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger id="mode-select" data-testid="select-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off — all prompts escalated</SelectItem>
                <SelectItem value="assist">Assist — policy handles permitted</SelectItem>
                <SelectItem value="full">Full — policy auto-executes</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cwd-input" className="text-xs text-muted-foreground">
              Workspace path <span className="text-muted-foreground/60">(optional)</span>
            </Label>
            <Input
              id="cwd-input"
              placeholder="/path/to/project"
              value={cwd}
              onChange={e => setCwd(e.target.value)}
              data-testid="input-cwd"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="label-input" className="text-xs text-muted-foreground">
              Label <span className="text-muted-foreground/60">(optional)</span>
            </Label>
            <Input
              id="label-input"
              placeholder="e.g. feature-branch-work"
              value={label}
              onChange={e => setLabel(e.target.value)}
              data-testid="input-label"
              className="text-sm"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={startMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending || (adapter === "custom" && !customCommand.trim())}
            data-testid="button-confirm-start"
          >
            {startMutation.isPending ? "Starting…" : "Start Session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Monitor Controls — start/stop desktop & VS Code monitors
// ---------------------------------------------------------------------------

interface DaemonStatus {
  running: boolean;
  startedAt?: string;
  logs: string[];
}

function MonitorControls() {
  const { data: daemons } = useQuery<Record<string, DaemonStatus>>({
    queryKey: ["/api/monitor/daemons"],
    refetchInterval: 3_000,
  });

  const { toast } = useToast();

  const startMutation = useMutation({
    mutationFn: async (type: string) => {
      const res = await apiRequest("POST", `/api/monitor/daemons/${type}/start`, {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/monitor/daemons"] });
      if (data.status === "started") {
        toast({ title: "Monitor started", description: `PID: ${data.pid}` });
      } else if (data.status === "already_running") {
        toast({ title: "Monitor already running" });
      }
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/monitor/daemons"] });
      toast({
        title: "Failed to start monitor",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const stopMutation = useMutation({
    mutationFn: (type: string) => apiRequest("POST", `/api/monitor/daemons/${type}/stop`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/monitor/daemons"] });
      toast({ title: "Monitor stopped" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to stop monitor", description: err.message, variant: "destructive" });
    },
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
// Managed Sessions Tab
// ---------------------------------------------------------------------------

function ManagedTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const { data: sessions, isLoading } = useQuery<Session[]>({
    queryKey: ["/api/sessions"],
  });

  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [ciFilter, setCiFilter] = useState<string>("all");
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [pausingId, setPausingId] = useState<string | null>(null);

  const navigateToChat = () => {
    const pollForSession = (attempts: number) => {
      if (attempts <= 0) { navigate("/chat"); return; }
      apiRequest("GET", "/api/sessions").then((r) => r.json()).then((list: Session[]) => {
        const newest = list
          .filter((s: Session) => s.status === "running")
          .sort((a: Session, b: Session) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0];
        if (newest) { navigate(`/chat?sessionId=${newest.id}`); }
        else { setTimeout(() => pollForSession(attempts - 1), 1000); }
      }).catch(() => { navigate("/chat"); });
    };
    setTimeout(() => pollForSession(3), 2000);
  };

  const stopMutation = useMutation({
    mutationFn: (sessionId: string) => apiRequest("POST", `/api/sessions/${sessionId}/stop`, {}),
    onSuccess: (_data, sessionId) => {
      toast({ title: "Session stopped", description: `Session ${sessionId.slice(0, 8)} received stop signal.` });
      qc.refetchQueries({ queryKey: ["/api/sessions"] });
      setStoppingId(null);
    },
    onError: (e: Error) => { toast({ title: "Stop failed", description: e.message, variant: "destructive" }); setStoppingId(null); },
  });

  const pauseMutation = useMutation({
    mutationFn: (sessionId: string) => apiRequest("POST", `/api/sessions/${sessionId}/pause`, {}),
    onSuccess: (_data, sessionId) => {
      toast({ title: "Session paused", description: `Session ${sessionId.slice(0, 8)} paused.` });
      qc.refetchQueries({ queryKey: ["/api/sessions"] });
      setPausingId(null);
    },
    onError: (e: Error) => { toast({ title: "Pause failed", description: e.message, variant: "destructive" }); setPausingId(null); },
  });

  const resumeMutation = useMutation({
    mutationFn: (sessionId: string) => apiRequest("POST", `/api/sessions/${sessionId}/resume`, {}),
    onSuccess: (_data, sessionId) => {
      toast({ title: "Session resumed", description: `Session ${sessionId.slice(0, 8)} resumed.` });
      qc.refetchQueries({ queryKey: ["/api/sessions"] });
    },
    onError: (e: Error) => { toast({ title: "Resume failed", description: e.message, variant: "destructive" }); },
  });

  const handleStop = (sessionId: string) => { setStoppingId(sessionId); stopMutation.mutate(sessionId); };
  const handlePause = (sessionId: string) => { setPausingId(sessionId); pauseMutation.mutate(sessionId); };

  const filtered = sessions?.filter(s => {
    if (search && !s.id.toLowerCase().includes(search.toLowerCase()) && !s.tool.toLowerCase().includes(search.toLowerCase())) return false;
    if (riskFilter !== "all" && s.riskLevel !== riskFilter) return false;
    if (statusFilter !== "all" && s.status !== statusFilter) return false;
    if (ciFilter !== "all" && s.ciSnapshot !== ciFilter) return false;
    return true;
  }) || [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setStartDialogOpen(true)} data-testid="button-start-session">
          <Play className="w-3.5 h-3.5 mr-1.5" />Start Session
        </Button>
      </div>

      <StartSessionDialog open={startDialogOpen} onOpenChange={setStartDialogOpen} onSessionStarted={navigateToChat} />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search by session ID or tool..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="input-session-search" />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Select value={riskFilter} onValueChange={setRiskFilter}>
                <SelectTrigger className="w-[130px]" data-testid="select-risk-filter"><SelectValue placeholder="Risk Level" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Risks</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[130px]" data-testid="select-status-filter"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="starting">Starting</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="awaiting_reply">Awaiting Reply</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="crashed">Crashed</SelectItem>
                  <SelectItem value="canceled">Canceled</SelectItem>
                </SelectContent>
              </Select>
              <Select value={ciFilter} onValueChange={setCiFilter}>
                <SelectTrigger className="w-[120px]" data-testid="select-ci-filter"><SelectValue placeholder="CI" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All CI</SelectItem>
                  <SelectItem value="pass">Pass</SelectItem>
                  <SelectItem value="fail">Fail</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card><CardContent className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</CardContent></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs">Session ID</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs">Tool</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs hidden lg:table-cell">Started</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs hidden md:table-cell">Last Activity</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs">Status</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs">Risk</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs hidden sm:table-cell">Esc.</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs hidden sm:table-cell">CI</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No sessions match your filters</td></tr>
                ) : (
                  filtered.map(session => (
                    <tr key={session.id} className="border-b last:border-0" data-testid={`row-session-${session.id}`}>
                      <td className="px-4 py-3"><span className="font-mono text-xs">{session.id}</span></td>
                      <td className="px-4 py-3 font-medium">{session.tool}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs hidden lg:table-cell">{formatTimestamp(session.startTime)}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs hidden md:table-cell">{timeAgo(session.lastActivity)}</td>
                      <td className="px-4 py-3"><Badge variant="secondary" className={`text-[10px] ${statusColor(session.status)}`}>{session.status}</Badge></td>
                      <td className="px-4 py-3"><Badge variant="secondary" className={`text-[10px] capitalize ${riskBg(session.riskLevel)}`}>{session.riskLevel}</Badge></td>
                      <td className="px-4 py-3 text-center hidden sm:table-cell">
                        {session.escalationsCount > 0 ? (
                          <span className="text-orange-600 dark:text-orange-400 font-medium text-xs">{session.escalationsCount}</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell"><Badge variant="secondary" className={`text-[10px] ${ciColor(session.ciSnapshot)}`}>{session.ciSnapshot}</Badge></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link href={`/sessions/${session.id}`}>
                            <button className="text-primary text-xs flex items-center gap-1" data-testid={`link-session-${session.id}`}>View <ExternalLink className="w-3 h-3" /></button>
                          </Link>
                          {PAUSABLE_STATUSES.has(session.status) && (
                            <button className="text-amber-600 dark:text-amber-400 text-xs flex items-center gap-1 disabled:opacity-50" onClick={() => handlePause(session.id)} disabled={pausingId === session.id} data-testid={`button-pause-${session.id}`} title="Pause session">
                              <Pause className="w-3 h-3" />{pausingId === session.id ? "…" : "Pause"}
                            </button>
                          )}
                          {session.status === "paused" && (
                            <button className="text-green-600 dark:text-green-400 text-xs flex items-center gap-1 disabled:opacity-50" onClick={() => resumeMutation.mutate(session.id)} disabled={resumeMutation.isPending} data-testid={`button-resume-${session.id}`} title="Resume session">
                              <Play className="w-3 h-3" />Resume
                            </button>
                          )}
                          {(ACTIVE_STATUSES.has(session.status) || session.status === "paused") && (
                            <button className="text-destructive text-xs flex items-center gap-1 disabled:opacity-50" onClick={() => handleStop(session.id)} disabled={stoppingId === session.id} data-testid={`button-stop-${session.id}`} title="Stop session">
                              <Square className="w-3 h-3" />{stoppingId === session.id ? "…" : "Stop"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monitored Activity Tab
// ---------------------------------------------------------------------------

function MonitoredTab() {
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<MonitorMessage[]>([]);
  const [lastSeq, setLastSeq] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: sessions, isLoading } = useQuery<MonitorSession[]>({
    queryKey: ["/api/monitor/sessions"],
  });

  useEffect(() => { setMessages([]); setLastSeq(0); }, [selectedSession]);

  const { data: newMessages } = useQuery<MonitorMessage[]>({
    queryKey: ["/api/monitor/sessions", selectedSession, "messages", lastSeq],
    queryFn: () =>
      apiRequest("GET", `/api/monitor/sessions/${encodeURIComponent(selectedSession!)}/messages?after_seq=${lastSeq}`).then((r) => r.json()),
    enabled: Boolean(selectedSession),
    refetchInterval: 2_500,
  });

  useEffect(() => {
    if (newMessages && newMessages.length > 0) {
      setMessages((prev) => [...prev, ...newMessages]);
      setLastSeq(newMessages[newMessages.length - 1].seq);
    }
  }, [newMessages]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const activeSessions = (sessions ?? []).filter((s) => s.status === "active");
  const endedSessions = (sessions ?? []).filter((s) => s.status === "ended");

  return (
    <div className="space-y-4">
      <MonitorControls />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">
            Monitored Sessions
            {activeSessions.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px]">{activeSessions.length} active</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
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
                    className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:bg-muted/50 ${isSelected ? "bg-primary/5 border-l-2 border-primary" : ""}`}
                    onClick={() => setSelectedSession(isSelected ? null : session.id)}
                    data-testid={`monitor-session-${session.id}`}
                  >
                    <VendorIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className={`text-[10px] ${v.color}`}>{v.label}</Badge>
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${session.status === "active" ? "bg-emerald-500" : "bg-gray-400"}`} />
                        <span className="text-[11px] text-muted-foreground">{ago(session.created_at)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5 font-mono">{session.tab_url || session.conversation_id}</div>
                    </div>
                    <code className="text-[10px] text-muted-foreground font-mono shrink-0">{session.id.slice(0, 8)}</code>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedSession && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              Conversation
              {messages.length > 0 && <Badge variant="secondary" className="text-[10px] ml-auto">{messages.length} messages</Badge>}
              <Button size="icon" variant="ghost" className="w-6 h-6 ml-1" onClick={() => setSelectedSession(null)}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[500px] overflow-y-auto" data-testid="monitor-transcript">
              {messages.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">Waiting for messages...</div>
              ) : (
                <div className="divide-y">
                  {messages.map((msg) => (
                    <div
                      key={`${msg.session_id}-${msg.seq}`}
                      className={`px-4 py-2 ${msg.role === "user" ? "bg-blue-500/5 border-l-2 border-blue-500/30" : "bg-muted/30"}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        {msg.role === "user" ? <User className="w-3 h-3 text-blue-500" /> : <Bot className="w-3 h-3 text-muted-foreground" />}
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{msg.role === "user" ? "You" : "Assistant"}</span>
                        <Badge variant="secondary" className={`text-[9px] ${vendorInfo(msg.vendor).color}`}>{vendorInfo(msg.vendor).label}</Badge>
                        <span className="text-[10px] text-muted-foreground ml-auto">{ago(msg.captured_at)}</span>
                      </div>
                      <pre className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-foreground/90">{msg.content}</pre>
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

// ---------------------------------------------------------------------------
// Main Sessions Page — unified with tabs
// ---------------------------------------------------------------------------

export default function SessionsPage() {
  const { data: sessions } = useQuery<Session[]>({ queryKey: ["/api/sessions"] });
  const { data: monitorSessions } = useQuery<MonitorSession[]>({ queryKey: ["/api/monitor/sessions"] });

  const managedActive = (sessions ?? []).filter(s => ACTIVE_STATUSES.has(s.status)).length;
  const monitoredActive = (monitorSessions ?? []).filter(s => s.status === "active").length;
  const vendorCount = new Set((monitorSessions ?? []).map(s => s.vendor)).size;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Sessions</h1>
        <p className="text-sm text-muted-foreground mt-1">Managed agent sessions and monitored AI activity</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Radio className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{managedActive}</p>
              <p className="text-xs text-muted-foreground">Active Managed</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-semibold">{monitoredActive}</p>
              <p className="text-xs text-muted-foreground">Monitored Active</p>
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

      {/* Tabs */}
      <Tabs defaultValue="managed" className="space-y-4">
        <TabsList>
          <TabsTrigger value="managed" data-testid="tab-managed">Managed</TabsTrigger>
          <TabsTrigger value="monitored" data-testid="tab-monitored">Monitored</TabsTrigger>
        </TabsList>
        <TabsContent value="managed"><ManagedTab /></TabsContent>
        <TabsContent value="monitored"><MonitoredTab /></TabsContent>
      </Tabs>
    </div>
  );
}
