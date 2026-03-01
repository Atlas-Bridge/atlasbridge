import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import type { SessionDetail, MonitorMessage } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { riskBg, statusColor, decisionColor, formatTimestamp, timeAgo, sanitizeText } from "@/lib/utils";
import { ArrowLeft, Info, ChevronDown, Code, CheckCircle2, XCircle, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const [rawOpen, setRawOpen] = useState(false);

  const { data, isLoading, error } = useQuery<SessionDetail>({
    queryKey: ["/api/sessions", params.id],
  });

  // Fetch monitor messages (approval/tool prompts from VS Code monitor)
  const { data: monitorData } = useQuery<{ messages: MonitorMessage[]; total: number }>({
    queryKey: ["/api/monitor/messages", "session-detail"],
    queryFn: async () => {
      const res = await fetch("/api/monitor/messages?limit=200");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const monitorPrompts = (monitorData?.messages ?? []).filter(
    (m) => m.permission_mode || m.tool_name,
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link href="/sessions">
          <Button variant="ghost" size="sm" data-testid="button-back-sessions">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Sessions
          </Button>
        </Link>
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Session not found
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/sessions">
          <Button variant="ghost" size="sm" data-testid="button-back-sessions">
            <ArrowLeft className="w-4 h-4 mr-1" /> Sessions
          </Button>
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-lg font-semibold font-mono" data-testid="text-session-id">{data.id}</h1>
        <Badge variant="secondary" className={statusColor(data.status)}>{data.status}</Badge>
        <Badge variant="secondary" className={`capitalize ${riskBg(data.riskLevel)}`}>{data.riskLevel}</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Session Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              {Object.entries(data.metadata).map(([key, val]) => (
                <div key={key} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground shrink-0">{key}</dt>
                  <dd className="text-right font-mono text-xs truncate">{sanitizeText(val)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 pt-2 border-t">
                <dt className="text-muted-foreground">Started</dt>
                <dd className="text-right text-xs">{formatTimestamp(data.startTime)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Last Activity</dt>
                <dd className="text-right text-xs">{timeAgo(data.lastActivity)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Escalations</dt>
                <dd className="text-right text-xs font-medium">
                  {data.escalationsCount > 0 ? (
                    <span className="text-orange-600 dark:text-orange-400">{data.escalationsCount}</span>
                  ) : "0"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" />
              Explain
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-explain">
              {data.explainPanel}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">
            Prompts ({data.prompts.length > 0 ? data.prompts.length : monitorPrompts.length})
          </CardTitle>
        </CardHeader>
        {data.prompts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-4 py-2 font-medium text-muted-foreground text-xs">ID</th>
                  <th className="px-4 py-2 font-medium text-muted-foreground text-xs">Content</th>
                  <th className="px-4 py-2 font-medium text-muted-foreground text-xs hidden sm:table-cell">Type</th>
                  <th className="px-4 py-2 font-medium text-muted-foreground text-xs hidden md:table-cell">Confidence</th>
                  <th className="px-4 py-2 font-medium text-muted-foreground text-xs">Decision</th>
                </tr>
              </thead>
              <tbody>
                {data.prompts.map(p => (
                  <tr key={p.id} className="border-b last:border-0" data-testid={`row-prompt-${p.id}`}>
                    <td className="px-4 py-2 font-mono text-xs">{p.id}</td>
                    <td className="px-4 py-2 max-w-[200px] truncate">{p.content}</td>
                    <td className="px-4 py-2 hidden sm:table-cell">
                      <Badge variant="secondary" className="text-[10px]">{p.type}</Badge>
                    </td>
                    <td className="px-4 py-2 hidden md:table-cell">
                      <span className={`font-mono text-xs ${p.confidence < 0.5 ? "text-orange-600 dark:text-orange-400" : ""}`}>
                        {(p.confidence * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="secondary" className={`text-[10px] ${decisionColor(p.decision)}`}>
                        {p.decision}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : monitorPrompts.length > 0 ? (
          <CardContent className="space-y-2 pt-0">
            {monitorPrompts.map((msg) => (
              <MonitorPromptRow key={msg.id} msg={msg} />
            ))}
          </CardContent>
        ) : (
          <CardContent>
            <p className="text-sm text-muted-foreground">No prompts in this session</p>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Decision Trace ({data.decisionTrace.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[300px] overflow-auto">
            {data.decisionTrace.map((trace, i) => (
              <div key={trace.id} className={`flex items-center gap-3 px-4 py-2.5 ${i < data.decisionTrace.length - 1 ? "border-b" : ""}`}>
                <span className="text-xs text-muted-foreground w-6 text-right shrink-0">
                  #{trace.stepIndex}
                </span>
                <Badge variant="secondary" className={`text-[10px] capitalize ${riskBg(trace.riskLevel)}`}>
                  {trace.riskLevel}
                </Badge>
                <span className="text-xs font-mono text-muted-foreground truncate">{trace.ruleMatched}</span>
                <span className="text-xs ml-auto shrink-0">{trace.action}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Collapsible open={rawOpen} onOpenChange={setRawOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="pb-3 cursor-pointer">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Code className="w-4 h-4" />
                Raw View (Sanitized)
                <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${rawOpen ? "rotate-180" : ""}`} />
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <pre className="bg-muted rounded-md p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap" data-testid="text-raw-view">
                {sanitizeText(data.rawView)}
              </pre>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}

function MonitorPromptRow({ msg }: { msg: MonitorMessage }) {
  const isApproval = msg.permission_mode === "approved" || msg.permission_mode === "rejected";
  const isTool = !!msg.tool_name;

  if (isApproval) {
    const approved = msg.permission_mode === "approved";
    return (
      <div
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg border",
          approved
            ? "bg-emerald-500/5 border-emerald-500/20"
            : "bg-red-500/5 border-red-500/20",
        )}
        data-testid={`monitor-prompt-${msg.id}`}
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
          {msg.tool_name && (
            <Badge
              variant="secondary"
              className="text-[10px] gap-0.5 px-1.5 py-0 ml-2"
            >
              <Wrench className="w-2.5 h-2.5" />
              {msg.tool_name}
            </Badge>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0">
          {formatTimestamp(msg.captured_at)}
        </span>
      </div>
    );
  }

  if (isTool) {
    return (
      <div
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-orange-500/5 border-orange-500/20"
        data-testid={`monitor-prompt-${msg.id}`}
      >
        <div className="w-7 h-7 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
          <Wrench className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium">Tool Request</span>
          <Badge
            variant="secondary"
            className="text-[10px] gap-0.5 px-1.5 py-0 ml-2 bg-orange-500/10 text-orange-700 dark:text-orange-300"
          >
            <Wrench className="w-2.5 h-2.5" />
            {msg.tool_name}
          </Badge>
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0">
          {formatTimestamp(msg.captured_at)}
        </span>
      </div>
    );
  }

  return null;
}
