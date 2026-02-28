import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import type { AuditEntry, PromptEntry, TraceEntry } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { riskBg, decisionColor, formatTimestamp } from "@/lib/utils";
import { Search, Download, ChevronLeft, ChevronRight, CheckCircle, XCircle, Link2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 15;

// ---------------------------------------------------------------------------
// All (Audit entries) tab
// ---------------------------------------------------------------------------

function AuditTab() {
  const { data: audit, isLoading } = useQuery<AuditEntry[]>({
    queryKey: ["/api/audit"],
    refetchInterval: 10_000,
  });

  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const { toast } = useToast();

  const filtered = useMemo(() => {
    if (!audit) return [];
    return audit.filter(a => {
      if (search && !a.message.toLowerCase().includes(search.toLowerCase()) &&
        !a.sessionId.toLowerCase().includes(search.toLowerCase()) &&
        !a.id.toLowerCase().includes(search.toLowerCase())) return false;
      if (riskFilter !== "all" && a.riskLevel !== riskFilter) return false;
      return true;
    });
  }, [audit, search, riskFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const exportData = (format: "json" | "csv") => {
    if (!filtered.length) return;
    let content: string;
    let mimeType: string;
    let ext: string;

    if (format === "json") {
      content = JSON.stringify(filtered, null, 2);
      mimeType = "application/json";
      ext = "json";
    } else {
      const headers = ["id", "timestamp", "riskLevel", "sessionId", "promptType", "actionTaken", "message", "hashVerified"];
      const rows = filtered.map(a => headers.map(h => `"${String(a[h as keyof AuditEntry]).replace(/"/g, '""')}"`).join(","));
      content = [headers.join(","), ...rows].join("\n");
      mimeType = "text/csv";
      ext = "csv";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `atlasbridge-audit.${ext}`;
    link.click();
    URL.revokeObjectURL(url);
    toast({ title: `Exported ${filtered.length} entries as ${ext.toUpperCase()}` });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search audit entries..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0); }}
                className="pl-9"
                data-testid="input-audit-search"
              />
            </div>
            <div className="flex gap-2">
              <Select value={riskFilter} onValueChange={v => { setRiskFilter(v); setPage(0); }}>
                <SelectTrigger className="w-[140px]" data-testid="select-audit-risk">
                  <SelectValue placeholder="Risk" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Risks</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="secondary" size="sm" onClick={() => exportData("json")} data-testid="button-export-json">
                <Download className="w-3.5 h-3.5 mr-1.5" /> JSON
              </Button>
              <Button variant="secondary" size="sm" onClick={() => exportData("csv")} data-testid="button-export-csv">
                <Download className="w-3.5 h-3.5 mr-1.5" /> CSV
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="p-4 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs">ID</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs">Message</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs">Risk</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs hidden sm:table-cell">Session</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs hidden md:table-cell">Action</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs hidden lg:table-cell">Hash</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs hidden lg:table-cell">Time</th>
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No audit entries match your search
                    </td>
                  </tr>
                ) : (
                  paginated.map(entry => (
                    <tr key={entry.id} className="border-b last:border-0" data-testid={`row-audit-${entry.id}`}>
                      <td className="px-4 py-2.5 font-mono text-xs">{entry.id}</td>
                      <td className="px-4 py-2.5 max-w-[250px] truncate">{entry.message}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant="secondary" className={`text-[10px] capitalize ${riskBg(entry.riskLevel)}`}>
                          {entry.riskLevel}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 hidden sm:table-cell font-mono text-xs text-muted-foreground">
                        {entry.sessionId}
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell text-xs text-muted-foreground">
                        {entry.actionTaken.replace(/_/g, " ")}
                      </td>
                      <td className="px-4 py-2.5 hidden lg:table-cell">
                        {entry.hashVerified ? (
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                        )}
                      </td>
                      <td className="px-4 py-2.5 hidden lg:table-cell text-xs text-muted-foreground">
                        {formatTimestamp(entry.timestamp)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t">
              <span className="text-xs text-muted-foreground">
                {filtered.length} entr{filtered.length !== 1 ? "ies" : "y"}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="button-audit-prev">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs text-muted-foreground px-2">{page + 1} / {totalPages}</span>
                <Button variant="ghost" size="icon" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} data-testid="button-audit-next">
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prompts tab
// ---------------------------------------------------------------------------

function PromptsTab() {
  const { data: prompts, isLoading } = useQuery<PromptEntry[]>({
    queryKey: ["/api/prompts"],
    refetchInterval: 10_000,
  });

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [decisionFilter, setDecisionFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  const filtered = prompts?.filter(p => {
    if (search && !p.id.toLowerCase().includes(search.toLowerCase()) && !p.content.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter !== "all" && p.type !== typeFilter) return false;
    if (decisionFilter !== "all" && p.decision !== decisionFilter) return false;
    return true;
  }) || [];

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search prompts..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0); }}
                className="pl-9"
                data-testid="input-prompt-search"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(0); }}>
                <SelectTrigger className="w-[150px]" data-testid="select-type-filter">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="yes_no">Yes/No</SelectItem>
                  <SelectItem value="confirm_enter">Confirm</SelectItem>
                  <SelectItem value="numbered_choice">Choice</SelectItem>
                  <SelectItem value="free_text">Free Text</SelectItem>
                  <SelectItem value="multi_select">Multi Select</SelectItem>
                </SelectContent>
              </Select>
              <Select value={decisionFilter} onValueChange={v => { setDecisionFilter(v); setPage(0); }}>
                <SelectTrigger className="w-[140px]" data-testid="select-decision-filter">
                  <SelectValue placeholder="Decision" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Decisions</SelectItem>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="human">Human</SelectItem>
                  <SelectItem value="escalated">Escalated</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs">ID</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs">Content</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs hidden sm:table-cell">Type</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs hidden md:table-cell">Confidence</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs">Decision</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs hidden lg:table-cell">Action</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs hidden md:table-cell">Time</th>
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No prompts match your filters
                    </td>
                  </tr>
                ) : (
                  paginated.map(prompt => (
                    <tr key={prompt.id} className="border-b last:border-0" data-testid={`row-prompt-${prompt.id}`}>
                      <td className="px-4 py-3 font-mono text-xs">{prompt.id}</td>
                      <td className="px-4 py-3 max-w-[250px] truncate">{prompt.content}</td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <Badge variant="secondary" className="text-[10px]">{prompt.type.replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full ${prompt.confidence >= 0.7 ? "bg-emerald-500" : prompt.confidence >= 0.5 ? "bg-amber-500" : "bg-red-500"}`}
                              style={{ width: `${prompt.confidence * 100}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs">{(prompt.confidence * 100).toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className={`text-[10px] ${decisionColor(prompt.decision)}`}>
                          {prompt.decision}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                        {prompt.actionTaken.replace(/_/g, " ")}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs text-muted-foreground">
                        {formatTimestamp(prompt.timestamp)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t">
              <span className="text-xs text-muted-foreground">
                {filtered.length} result{filtered.length !== 1 ? "s" : ""}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="button-prev-page">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs text-muted-foreground px-2">{page + 1} / {totalPages}</span>
                <Button variant="ghost" size="icon" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} data-testid="button-next-page">
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Traces tab
// ---------------------------------------------------------------------------

function TracesTab() {
  const { data: traces, isLoading } = useQuery<TraceEntry[]>({
    queryKey: ["/api/traces"],
    refetchInterval: 10_000,
  });

  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!traces) return [];
    let filtered = [...traces];
    if (riskFilter !== "all") {
      filtered = filtered.filter(t => t.riskLevel === riskFilter);
    }
    return filtered.sort((a, b) => {
      const timeDiff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.id.localeCompare(a.id);
    });
  }, [traces, riskFilter]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paginated = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={riskFilter} onValueChange={v => { setRiskFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[140px]" data-testid="select-trace-risk-filter">
                <SelectValue placeholder="Risk Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Risks</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground ml-auto">
              {sorted.length} trace{sorted.length !== 1 ? "s" : ""}
            </span>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="p-4 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs w-10">#</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs">
                    <span className="flex items-center gap-1"><Link2 className="w-3 h-3" /> Hash</span>
                  </th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs">Risk</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs hidden sm:table-cell">Rule Matched</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs">Action</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs hidden md:table-cell">Session</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-xs hidden lg:table-cell">Time</th>
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No traces match your filter
                    </td>
                  </tr>
                ) : (
                  paginated.map(trace => (
                    <tr key={trace.id} className="border-b last:border-0" data-testid={`row-trace-${trace.id}`}>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{trace.stepIndex}</td>
                      <td className="px-4 py-2.5">
                        <code className="text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {trace.hash.slice(0, 20)}...
                        </code>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="secondary" className={`text-[10px] capitalize ${riskBg(trace.riskLevel)}`}>
                          {trace.riskLevel}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 hidden sm:table-cell">
                        <span className="font-mono text-xs">{trace.ruleMatched}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-medium ${
                          trace.action === "blocked" ? "text-red-600 dark:text-red-400" :
                          trace.action === "escalated" ? "text-orange-600 dark:text-orange-400" :
                          trace.action === "flagged" ? "text-amber-600 dark:text-amber-400" :
                          "text-emerald-600 dark:text-emerald-400"
                        }`}>
                          {trace.action}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell">
                        <span className="font-mono text-xs text-muted-foreground">{trace.sessionId}</span>
                      </td>
                      <td className="px-4 py-2.5 hidden lg:table-cell text-xs text-muted-foreground">
                        {formatTimestamp(trace.timestamp)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t">
              <span className="text-xs text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="button-traces-prev">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} data-testid="button-traces-next">
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit Log page — tabbed view combining All, Prompts, and Traces
// ---------------------------------------------------------------------------

export default function AuditPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Audit Log</h1>
        <p className="text-sm text-muted-foreground mt-1">Unified view of audit entries, decision prompts, and hash-chained traces</p>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="prompts">Prompts</TabsTrigger>
          <TabsTrigger value="traces">Traces</TabsTrigger>
        </TabsList>
        <TabsContent value="all">
          <AuditTab />
        </TabsContent>
        <TabsContent value="prompts">
          <PromptsTab />
        </TabsContent>
        <TabsContent value="traces">
          <TracesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
