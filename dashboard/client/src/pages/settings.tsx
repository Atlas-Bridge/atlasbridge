import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { SettingsData, OrgSettingsData, SecurityPolicy } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import {
  Copy, FolderOpen, Database, GitBranch, Tag, Globe, Flag, Lock,
  Bell, FileCheck,
  ChevronDown, ShieldCheck, ShieldAlert, Clock,
  CheckCircle, XCircle, AlertTriangle, Server, Eye, Fingerprint,
  Plus, Trash2, Edit, Pencil, Loader2,
  Key, FolderCheck, AlertCircle, ShieldOff, Sparkles, Shield, Power, ToggleLeft, ToggleRight
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "--";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString();
}

function ago(d: Date | string | null | undefined): string {
  if (!d) return "--";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

const ORG_QUERY_KEY = ["/api/settings/organization"];

function GeneralTab({ data }: { data: SettingsData }) {
  const { toast } = useToast();
  const copyDiagnostics = () => {
    const report = [
      "=== AtlasBridge Diagnostics Report ===",
      `Version: ${data.version}`, `Environment: ${data.environment}`,
      `Config: ${data.configPath}`, `Database: ${data.dbPath}`, `Traces: ${data.tracePath}`,
      "", "Feature Flags:", ...Object.entries(data.featureFlags).map(([k, v]) => `  ${k}: ${v}`),
      "", `Generated: ${new Date().toISOString()}`, "Tokens: [REDACTED]",
    ].join("\n");
    navigator.clipboard.writeText(report).then(() => {
      toast({ title: "Diagnostics copied", description: "Sanitized report copied to clipboard" });
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={copyDiagnostics} data-testid="button-copy-diagnostics">
          <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy Diagnostics
        </Button>
      </div>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">System Configuration</CardTitle></CardHeader>
        <CardContent>
          <dl className="space-y-4">
            {([
              [FolderOpen, "Config Path", data.configPath],
              [Database, "Database Path", data.dbPath],
              [GitBranch, "Trace Path", data.tracePath],
              [Tag, "Version", data.version],
              [Globe, "Environment", data.environment],
            ] as [typeof FolderOpen, string, string][]).map(([IconComp, label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4" data-testid={`setting-${label.toLowerCase().replace(/\s/g, "-")}`}>
                <dt className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
                  <IconComp className="w-4 h-4" />{label}
                </dt>
                <dd><code className="text-xs font-mono bg-muted px-2 py-1 rounded">{value}</code></dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2"><Flag className="w-4 h-4 text-primary" />Feature Flags</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.entries(data.featureFlags).map(([flag, enabled]) => (
              <div key={flag} className="flex items-center justify-between gap-2 p-2.5 rounded-md bg-muted/50" data-testid={`flag-${flag}`}>
                <span className="text-sm">{flag.replace(/_/g, " ")}</span>
                <Badge variant="secondary" className={`text-[10px] ${enabled ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
                  {enabled ? "enabled" : "disabled"}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SecurityTab({ org }: { org: OrgSettingsData }) {
  const { toast } = useToast();
  const categories = Array.from(new Set(org.securityPolicies.map(p => p.category)));

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => apiRequest("PATCH", `/api/security-policies/${id}`, { enabled }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ORG_QUERY_KEY }); toast({ title: "Policy updated" }); },
  });

  const updateValueMutation = useMutation({
    mutationFn: ({ id, value }: { id: number; value: string }) => apiRequest("PATCH", `/api/security-policies/${id}`, { value }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ORG_QUERY_KEY }); toast({ title: "Policy value updated" }); },
  });

  const [editingPolicy, setEditingPolicy] = useState<SecurityPolicy | null>(null);
  const [editValue, setEditValue] = useState("");

  const severityIcon = (s: string) => {
    switch (s) {
      case "critical": return <ShieldAlert className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />;
      case "warning": return <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />;
      default: return <ShieldCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />;
    }
  };

  return (
    <div className="space-y-4">
      {categories.map(category => (
        <Card key={category}>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">{category}</CardTitle></CardHeader>
          <CardContent className="space-y-2 p-3">
            {org.securityPolicies.filter(p => p.category === category).map(policy => (
              <div key={policy.id} className="flex items-start gap-3 p-3 rounded-md bg-muted/50" data-testid={`policy-${policy.id}`}>
                <div className="mt-0.5 shrink-0">{severityIcon(policy.severity)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{policy.name}</span>
                    <Switch checked={policy.enabled} onCheckedChange={(checked) => toggleMutation.mutate({ id: policy.id, enabled: checked })} data-testid={`switch-policy-${policy.id}`} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{policy.description}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded">{policy.value}</code>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => { setEditingPolicy(policy); setEditValue(policy.value); }} data-testid={`button-edit-policy-${policy.id}`}>
                      <Edit className="w-3 h-3 mr-1" />Edit
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!editingPolicy} onOpenChange={(open) => { if (!open) setEditingPolicy(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Policy: {editingPolicy?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Value</Label><Input value={editValue} onChange={e => setEditValue(e.target.value)} data-testid="input-policy-value" /></div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={() => { if (editingPolicy) { updateValueMutation.mutate({ id: editingPolicy.id, value: editValue }); setEditingPolicy(null); } }} data-testid="button-save-policy">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-medium flex items-center gap-2"><Server className="w-4 h-4 text-primary" />Session Policy</CardTitle></CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            {[
              ["Max Concurrent Sessions", String(org.sessionPolicy.maxConcurrentSessions)],
              ["Session Timeout", `${org.sessionPolicy.sessionTimeoutMinutes} min`],
              ["Inactivity Timeout", `${org.sessionPolicy.inactivityTimeoutMinutes} min`],
              ["Auto-Terminate on Escalation", org.sessionPolicy.autoTerminateOnEscalation ? "Yes" : "No"],
              ["Require Approval Above Risk", org.sessionPolicy.requireApprovalAboveRisk],
              ["Max Escalations per Session", String(org.sessionPolicy.maxEscalationsPerSession)],
              ["Record All Sessions", org.sessionPolicy.recordAllSessions ? "Yes" : "No"],
              ["Risk Auto-Escalation", `${(org.sessionPolicy.riskAutoEscalationThreshold * 100).toFixed(0)}%`],
            ].map(([l, v]) => (
              <div key={String(l)} className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">{String(l)}</dt><dd><code className="text-xs font-mono bg-muted px-2 py-1 rounded">{String(v)}</code></dd></div>
            ))}
          </dl>
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Allowed Tools</p>
            <div className="flex flex-wrap gap-1">{org.sessionPolicy.allowedTools.map(t => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}</div>
            <p className="text-xs font-medium text-muted-foreground mt-3">Blocked Patterns</p>
            <div className="flex flex-wrap gap-1">{org.sessionPolicy.blockedTools.map(t => <Badge key={t} variant="secondary" className="text-[10px] bg-red-500/10 text-red-700 dark:text-red-300">{t}</Badge>)}</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface RetentionData { id: number; auditRetentionDays: number; traceRetentionDays: number; sessionRetentionDays: number; updatedAt: string; }

function RetentionTab() {
  const { toast } = useToast();
  const { data: retention, isLoading } = useQuery<RetentionData>({ queryKey: ["/api/settings/retention"], refetchInterval: 30_000 });
  const [audit, setAudit] = useState(730);
  const [trace, setTrace] = useState(365);
  const [session, setSession] = useState(180);
  const [initialized, setInitialized] = useState(false);

  if (retention && !initialized) { setAudit(retention.auditRetentionDays); setTrace(retention.traceRetentionDays); setSession(retention.sessionRetentionDays); setInitialized(true); }

  const saveMutation = useMutation({
    mutationFn: (data: { auditRetentionDays: number; traceRetentionDays: number; sessionRetentionDays: number }) => apiRequest("PATCH", "/api/settings/retention", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/settings/retention"] }); toast({ title: "Retention settings saved" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  const hasChanges = retention && (audit !== retention.auditRetentionDays || trace !== retention.traceRetentionDays || session !== retention.sessionRetentionDays);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-medium flex items-center gap-2"><FileCheck className="w-4 h-4 text-primary" />Retention Configuration</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Audit Retention (days)</Label>
              <Input type="number" min={1} max={3650} value={audit} onChange={e => setAudit(parseInt(e.target.value) || 0)} />
              <p className="text-[10px] text-muted-foreground mt-1">Hash-chained audit events</p>
            </div>
            <div>
              <Label className="text-xs">Trace Retention (days)</Label>
              <Input type="number" min={1} max={3650} value={trace} onChange={e => setTrace(parseInt(e.target.value) || 0)} />
              <p className="text-[10px] text-muted-foreground mt-1">Decision trace JSONL</p>
            </div>
            <div>
              <Label className="text-xs">Session Retention (days)</Label>
              <Input type="number" min={1} max={3650} value={session} onChange={e => setSession(parseInt(e.target.value) || 0)} />
              <p className="text-[10px] text-muted-foreground mt-1">Session + prompt records</p>
            </div>
          </div>
          <div className="flex items-center justify-between pt-2 border-t">
            <p className="text-[11px] text-muted-foreground">{retention?.updatedAt ? `Last updated: ${fmt(retention.updatedAt)}` : ""}</p>
            <Button size="sm" onClick={() => saveMutation.mutate({ auditRetentionDays: audit, traceRetentionDays: trace, sessionRetentionDays: session })} disabled={!hasChanges || saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const NOTIF_EVENTS = ["trust.granted", "trust.revoked", "scan.complete", "session.started", "session.ended", "escalation", "policy.violation"];

function NotificationsTab({ org }: { org: OrgSettingsData }) {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newNotif, setNewNotif] = useState({ channel: "slack", name: "", destination: "", minSeverity: "info", events: [] as string[] });
  const [editNotif, setEditNotif] = useState<typeof org.notifications[0] | null>(null);
  const [editFields, setEditFields] = useState({ name: "", destination: "", minSeverity: "info", events: [] as string[] });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/notifications", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ORG_QUERY_KEY }); setShowCreate(false); setNewNotif({ channel: "slack", name: "", destination: "", minSeverity: "info", events: [] }); toast({ title: "Channel created" }); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/notifications/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ORG_QUERY_KEY }); setEditNotif(null); toast({ title: "Channel updated" }); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => apiRequest("PATCH", `/api/notifications/${id}`, { enabled }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ORG_QUERY_KEY }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/notifications/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ORG_QUERY_KEY }); toast({ title: "Channel removed" }); },
  });

  const testMutation = useMutation({
    mutationFn: async (id: number) => { const res = await apiRequest("POST", `/api/notifications/${id}/test`); return res.json(); },
    onSuccess: (data: any) => toast({ title: data.success ? "Test sent" : "Test failed", description: data.error || "Notification delivered successfully", variant: data.success ? "default" : "destructive" }),
    onError: (e: Error) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  const channelBadge = (ch: string) => {
    const cls: Record<string, string> = { slack: "bg-purple-500/10 text-purple-700 dark:text-purple-300", email: "bg-blue-500/10 text-blue-700 dark:text-blue-300", pagerduty: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", webhook: "bg-orange-500/10 text-orange-700 dark:text-orange-300", opsgenie: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300", teams: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" };
    return <Badge variant="secondary" className={`text-[10px] ${cls[ch] || ""}`}>{ch}</Badge>;
  };

  const destPlaceholder = (ch: string) => {
    const m: Record<string, string> = { slack: "https://hooks.slack.com/services/...", teams: "https://outlook.office.com/webhook/...", email: "team@company.com", webhook: "https://...", pagerduty: "routing-key", opsgenie: "genie-key" };
    return m[ch] || "https://...";
  };

  const toggleEvent = (events: string[], ev: string) => events.includes(ev) ? events.filter(e => e !== ev) : [...events, ev];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2"><Bell className="w-4 h-4 text-primary" />Notification Channels ({org.notifications.length})</CardTitle>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild><Button size="sm" data-testid="button-create-notification"><Plus className="w-3.5 h-3.5 mr-1" />Add Channel</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Notification Channel</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Channel Type</Label>
                  <Select value={newNotif.channel} onValueChange={v => setNewNotif(p => ({ ...p, channel: v }))}>
                    <SelectTrigger data-testid="select-notif-channel"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="slack">Slack</SelectItem><SelectItem value="teams">Microsoft Teams</SelectItem><SelectItem value="email">Email</SelectItem><SelectItem value="webhook">Webhook</SelectItem><SelectItem value="pagerduty">PagerDuty</SelectItem><SelectItem value="opsgenie">OpsGenie</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>Name</Label><Input value={newNotif.name} onChange={e => setNewNotif(p => ({ ...p, name: e.target.value }))} data-testid="input-notif-name" /></div>
                <div><Label>Destination</Label><Input value={newNotif.destination} onChange={e => setNewNotif(p => ({ ...p, destination: e.target.value }))} placeholder={destPlaceholder(newNotif.channel)} data-testid="input-notif-destination" /></div>
                <div>
                  <Label>Events (optional — leave empty for all events)</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">{NOTIF_EVENTS.map(ev => (
                    <Badge key={ev} variant={newNotif.events.includes(ev) ? "default" : "outline"} className="cursor-pointer text-[10px]" onClick={() => setNewNotif(p => ({ ...p, events: toggleEvent(p.events, ev) }))}>{ev}</Badge>
                  ))}</div>
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                <Button onClick={() => createMutation.mutate(newNotif)} disabled={!newNotif.name || !newNotif.destination || createMutation.isPending} data-testid="button-submit-notification">Add</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-2 p-3">
          {org.notifications.map(notif => (
            <div key={notif.id} className="p-3 rounded-md bg-muted/50 space-y-2" data-testid={`notif-${notif.id}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  {channelBadge(notif.channel)}
                  <span className="text-sm font-medium">{notif.name}</span>
                  {(notif as any).lastDeliveryStatus === "success" && <CheckCircle className="w-3 h-3 text-emerald-500" />}
                  {(notif as any).lastDeliveryStatus === "failed" && <span title={(notif as any).lastDeliveryError || "Delivery failed"}><XCircle className="w-3 h-3 text-red-500" /></span>}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={() => testMutation.mutate(notif.id)} disabled={testMutation.isPending}>
                    {testMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Test"}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditNotif(notif); setEditFields({ name: notif.name, destination: notif.destination, minSeverity: notif.minSeverity, events: (notif.events || []) as string[] }); }}><Pencil className="w-3 h-3" /></Button>
                  <Switch checked={notif.enabled} onCheckedChange={(checked) => toggleMutation.mutate({ id: notif.id, enabled: checked })} data-testid={`switch-notif-${notif.id}`} />
                  <AlertDialog>
                    <AlertDialogTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-7 p-0" data-testid={`button-delete-notif-${notif.id}`}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button></AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader><AlertDialogTitle>Remove Channel</AlertDialogTitle><AlertDialogDescription>Remove "{notif.name}"?</AlertDialogDescription></AlertDialogHeader>
                      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteMutation.mutate(notif.id)}>Remove</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded">{notif.destination}</code>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex flex-wrap gap-1">{(notif.events as string[] || []).slice(0, 3).map(e => <Badge key={e} variant="secondary" className="text-[10px] font-mono">{e}</Badge>)}{((notif.events as string[]) || []).length > 3 && <Badge variant="secondary" className="text-[10px]">+{((notif.events as string[]) || []).length - 3}</Badge>}</div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0"><Clock className="w-3 h-3" />{ago(notif.lastDelivered)}</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!editNotif} onOpenChange={(open) => { if (!open) setEditNotif(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Channel</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name</Label><Input value={editFields.name} onChange={e => setEditFields(p => ({ ...p, name: e.target.value }))} /></div>
            <div><Label>Destination</Label><Input value={editFields.destination} onChange={e => setEditFields(p => ({ ...p, destination: e.target.value }))} /></div>
            <div>
              <Label>Min Severity</Label>
              <Select value={editFields.minSeverity} onValueChange={v => setEditFields(p => ({ ...p, minSeverity: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="info">Info</SelectItem><SelectItem value="warning">Warning</SelectItem><SelectItem value="error">Error</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label>Events</Label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">{NOTIF_EVENTS.map(ev => (
                <Badge key={ev} variant={editFields.events.includes(ev) ? "default" : "outline"} className="cursor-pointer text-[10px]" onClick={() => setEditFields(p => ({ ...p, events: toggleEvent(p.events, ev) }))}>{ev}</Badge>
              ))}</div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={() => editNotif && updateMutation.mutate({ id: editNotif.id, data: editFields })} disabled={!editFields.name || updateMutation.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Providers tab
// ---------------------------------------------------------------------------

interface ProviderConfig {
  provider: string;
  status: "configured" | "validated" | "invalid";
  key_prefix: string | null;
  configured_at: string | null;
  validated_at: string | null;
  last_error: string | null;
}

const PROVIDERS_QUERY_KEY = ["/api/providers"];
const SUPPORTED_PROVIDERS = ["openai", "anthropic", "gemini"] as const;
type SupportedProvider = typeof SUPPORTED_PROVIDERS[number];
const PROVIDER_INFO: Record<SupportedProvider, { label: string; keyHint: string }> = {
  openai: { label: "OpenAI", keyHint: "sk-…" },
  anthropic: { label: "Anthropic", keyHint: "sk-ant-…" },
  gemini: { label: "Google Gemini", keyHint: "AIza…" },
};

function ProviderStatusBadge({ status }: { status: string }) {
  if (status === "validated") return <Badge className="bg-emerald-600 text-white gap-1"><CheckCircle className="w-3 h-3" />Validated</Badge>;
  if (status === "configured") return <Badge variant="secondary" className="gap-1"><AlertCircle className="w-3 h-3" />Configured</Badge>;
  return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />Invalid</Badge>;
}

function ProviderCard({ provider, config }: { provider: SupportedProvider; config: ProviderConfig | undefined }) {
  const { toast } = useToast();
  const info = PROVIDER_INFO[provider];
  const [keyValue, setKeyValue] = useState("");
  const [showInput, setShowInput] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (key: string) => apiRequest("POST", "/api/providers", { provider, key }),
    onSuccess: () => {
      toast({ title: "Key saved", description: `${info.label} key stored securely.` });
      queryClient.invalidateQueries({ queryKey: PROVIDERS_QUERY_KEY });
      setKeyValue(""); setShowInput(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const validateMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/providers/${provider}/validate`),
    onSuccess: () => { toast({ title: "Validated", description: `${info.label} key is valid.` }); queryClient.invalidateQueries({ queryKey: PROVIDERS_QUERY_KEY }); },
    onError: (e: Error) => toast({ title: "Validation failed", description: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/providers/${provider}`),
    onSuccess: () => { toast({ title: "Removed", description: `${info.label} key removed.` }); queryClient.invalidateQueries({ queryKey: PROVIDERS_QUERY_KEY }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Key className="w-4 h-4 text-muted-foreground" />{info.label}</CardTitle>
          {config && <ProviderStatusBadge status={config.status} />}
        </div>
        {config?.key_prefix && <p className="font-mono text-xs text-muted-foreground mt-1">Key: {config.key_prefix}</p>}
        {config?.last_error && config.status === "invalid" && <p className="text-destructive text-xs mt-1">{config.last_error}</p>}
      </CardHeader>
      <CardContent className="space-y-3">
        {showInput ? (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">API key — stored securely, never displayed again</Label>
            <Input type="password" placeholder={info.keyHint} value={keyValue} onChange={e => setKeyValue(e.target.value)} onKeyDown={e => e.key === "Enter" && keyValue && saveMutation.mutate(keyValue)} className="font-mono text-sm" />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => keyValue && saveMutation.mutate(keyValue)} disabled={!keyValue || saveMutation.isPending}>{saveMutation.isPending ? "Saving…" : "Save"}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowInput(false); setKeyValue(""); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={config ? "outline" : "default"} onClick={() => setShowInput(true)}>{config ? "Replace key" : "Add key"}</Button>
            {config && (
              <>
                <Button size="sm" variant="outline" onClick={() => validateMutation.mutate()} disabled={validateMutation.isPending}>{validateMutation.isPending ? "Validating…" : "Validate"}</Button>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => removeMutation.mutate()} disabled={removeMutation.isPending}><Trash2 className="w-3.5 h-3.5 mr-1" />Remove</Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Authentication tab — GitHub App / OIDC provider management
// ---------------------------------------------------------------------------

interface AuthProviderEntry {
  id: number;
  type: "github-app" | "oidc";
  provider: string;
  name: string;
  createdAt: string;
}

const AUTH_PROVIDERS_QUERY_KEY = ["/api/auth-providers"];

function AuthenticationTab() {
  const { toast } = useToast();
  const { data: authProviders, isLoading } = useQuery<AuthProviderEntry[]>({ queryKey: AUTH_PROVIDERS_QUERY_KEY, refetchInterval: 15_000 });
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState<"github-app" | "oidc">("github-app");
  const [addName, setAddName] = useState("");
  const [addProvider, setAddProvider] = useState("github");
  // Structured OIDC fields
  const [oidcIssuer, setOidcIssuer] = useState("");
  const [oidcClientId, setOidcClientId] = useState("");
  const [oidcSecret, setOidcSecret] = useState("");
  const [oidcRedirect, setOidcRedirect] = useState("http://localhost:3737/api/auth/oidc/callback");
  const [oidcScopes, setOidcScopes] = useState("openid profile email");
  // Structured GitHub App fields
  const [ghAppId, setGhAppId] = useState("");
  const [ghKeyPath, setGhKeyPath] = useState("");
  const [ghInstallId, setGhInstallId] = useState("");

  const resetForm = () => {
    setAddName(""); setAddProvider("github");
    setOidcIssuer(""); setOidcClientId(""); setOidcSecret(""); setOidcRedirect("http://localhost:3737/api/auth/oidc/callback"); setOidcScopes("openid profile email");
    setGhAppId(""); setGhKeyPath(""); setGhInstallId("");
  };

  const buildConfig = () => {
    if (addType === "oidc") return JSON.stringify({ issuerUrl: oidcIssuer, clientId: oidcClientId, clientSecretPath: oidcSecret, redirectUri: oidcRedirect, scopes: oidcScopes.split(/\s+/).filter(Boolean) });
    return JSON.stringify({ appId: ghAppId, privateKeyPath: ghKeyPath, installationId: ghInstallId });
  };

  const canCreate = addName && (addType === "oidc" ? oidcIssuer && oidcClientId : ghAppId && ghKeyPath && ghInstallId);

  const createMutation = useMutation({
    mutationFn: (data: { type: string; provider: string; name: string; config: string }) => apiRequest("POST", "/api/auth-providers", data),
    onSuccess: () => { toast({ title: "Auth provider created" }); queryClient.invalidateQueries({ queryKey: AUTH_PROVIDERS_QUERY_KEY }); setShowAdd(false); resetForm(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/auth-providers/${id}`),
    onSuccess: () => { toast({ title: "Auth provider deleted" }); queryClient.invalidateQueries({ queryKey: AUTH_PROVIDERS_QUERY_KEY }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: async (id: number) => { const res = await apiRequest("POST", `/api/auth-providers/${id}/test`); return res.json(); },
    onSuccess: (data: any) => toast({ title: "Test result", description: data.success ? "Connection successful" : `Failed: ${data.error || "Unknown error"}` }),
    onError: (e: Error) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  const providers = authProviders ?? [];

  return (
    <div className="space-y-4">
      <Card className="border-dashed bg-muted/30">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Authentication providers control access to this dashboard and enable authenticated scanning of private repositories. GitHub App tokens never leave disk. OIDC flows complete in your browser.</p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)} data-testid="add-auth-provider"><Plus className="w-4 h-4 mr-1.5" />Add Provider</Button>
      </div>

      {showAdd && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Add Authentication Provider</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={addType} onValueChange={(v) => { setAddType(v as "github-app" | "oidc"); setAddProvider(v === "github-app" ? "github" : ""); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="github-app">GitHub App</SelectItem><SelectItem value="oidc">OIDC</SelectItem></SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Provider Name</Label>
                <Input value={addProvider} onChange={(e) => setAddProvider(e.target.value)} placeholder={addType === "oidc" ? "e.g. okta, azure-ad, auth0" : "github"} />
              </div>
            </div>
            <div><Label className="text-xs">Display Name</Label><Input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder={addType === "oidc" ? "My OIDC Provider" : "My GitHub App"} /></div>

            {addType === "oidc" ? (
              <div className="space-y-3 pt-2 border-t">
                <p className="text-[11px] font-medium text-muted-foreground">OIDC Configuration</p>
                <div><Label className="text-xs">Issuer URL</Label><Input value={oidcIssuer} onChange={e => setOidcIssuer(e.target.value)} placeholder="https://accounts.google.com" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Client ID</Label><Input value={oidcClientId} onChange={e => setOidcClientId(e.target.value)} /></div>
                  <div><Label className="text-xs">Client Secret (path on disk)</Label><Input type="password" value={oidcSecret} onChange={e => setOidcSecret(e.target.value)} placeholder="/path/to/secret" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Redirect URI</Label><Input value={oidcRedirect} onChange={e => setOidcRedirect(e.target.value)} /></div>
                  <div><Label className="text-xs">Scopes</Label><Input value={oidcScopes} onChange={e => setOidcScopes(e.target.value)} placeholder="openid profile email" /></div>
                </div>
              </div>
            ) : (
              <div className="space-y-3 pt-2 border-t">
                <p className="text-[11px] font-medium text-muted-foreground">GitHub App Configuration</p>
                <div><Label className="text-xs">App ID</Label><Input value={ghAppId} onChange={e => setGhAppId(e.target.value)} placeholder="123456" /></div>
                <div><Label className="text-xs">Private Key Path (on disk)</Label><Input value={ghKeyPath} onChange={e => setGhKeyPath(e.target.value)} placeholder="/path/to/private-key.pem" /></div>
                <div><Label className="text-xs">Installation ID</Label><Input value={ghInstallId} onChange={e => setGhInstallId(e.target.value)} placeholder="12345678" /></div>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" size="sm" onClick={() => { setShowAdd(false); resetForm(); }}>Cancel</Button>
              <Button size="sm" onClick={() => createMutation.mutate({ type: addType, provider: addProvider, name: addName, config: buildConfig() })} disabled={!canCreate || createMutation.isPending}>{createMutation.isPending ? "Creating..." : "Create"}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">{[1, 2].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : providers.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <Fingerprint className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No authentication providers configured.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {providers.map(p => (
            <Card key={p.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${p.type === "github-app" ? "bg-gray-100 dark:bg-gray-800" : "bg-blue-50 dark:bg-blue-900/30"}`}>
                    {p.type === "github-app" ? <Lock className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.type === "github-app" ? "GitHub App" : "OIDC"} &middot; {p.provider} &middot; {ago(p.createdAt)}</p>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => testMutation.mutate(p.id)} disabled={testMutation.isPending}>{testMutation.isPending ? "Testing..." : "Test"}</Button>
                  {p.type === "oidc" && <Button size="sm" variant="outline" asChild><a href={`/api/auth/oidc/${p.id}/authorize`}>Authorize</a></Button>}
                  <AlertDialog>
                    <AlertDialogTrigger asChild><Button size="sm" variant="ghost"><Trash2 className="w-4 h-4 text-destructive" /></Button></AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader><AlertDialogTitle>Delete auth provider?</AlertDialogTitle><AlertDialogDescription>This will remove "{p.name}" and any linked repo connections will fall back to PAT authentication.</AlertDialogDescription></AlertDialogHeader>
                      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteMutation.mutate(p.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ProvidersTab() {
  const { data: providers, isLoading } = useQuery<ProviderConfig[]>({ queryKey: PROVIDERS_QUERY_KEY, refetchInterval: 15_000 });
  const configMap = Object.fromEntries((providers ?? []).map(p => [p.provider, p])) as Record<string, ProviderConfig>;

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{SUPPORTED_PROVIDERS.map(p => <Skeleton key={p} className="h-40 w-full" />)}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SUPPORTED_PROVIDERS.map(p => <ProviderCard key={p} provider={p} config={configMap[p]} />)}
        </div>
      )}
      <Card className="border-dashed">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground"><strong>Storage:</strong> API keys are stored in your OS keychain (macOS Keychain, Linux Secret Service). Only a short prefix is shown. Keys are never transmitted to AtlasBridge servers and never appear in logs or audit traces.</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspaces tab
// ---------------------------------------------------------------------------

interface WorkspaceRecord {
  id: string;
  path: string;
  path_hash: string;
  trusted: number;
  actor: string | null;
  channel: string | null;
  session_id: string | null;
  granted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const WORKSPACES_QUERY_KEY = ["/api/workspaces"];

function WorkspacesTab() {
  const { toast } = useToast();
  const { data: workspaces, isLoading } = useQuery<WorkspaceRecord[]>({ queryKey: WORKSPACES_QUERY_KEY, refetchInterval: 10_000 });
  const [newPath, setNewPath] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const trustMutation = useMutation({
    mutationFn: (path: string) => apiRequest("POST", "/api/workspaces/trust", { path }),
    onSuccess: () => { toast({ title: "Trust granted", description: "Workspace marked as trusted." }); queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }); setNewPath(""); setShowAdd(false); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: (path: string) => apiRequest("DELETE", "/api/workspaces/trust", { path }),
    onSuccess: () => { toast({ title: "Trust revoked" }); queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (path: string) => apiRequest("POST", "/api/workspaces/remove", { path }),
    onMutate: async (path) => {
      await queryClient.cancelQueries({ queryKey: WORKSPACES_QUERY_KEY });
      const prev = queryClient.getQueryData<WorkspaceRecord[]>(WORKSPACES_QUERY_KEY);
      queryClient.setQueryData<WorkspaceRecord[]>(WORKSPACES_QUERY_KEY, old => old?.filter(ws => ws.path !== path) ?? []);
      return { prev };
    },
    onError: (e: Error, _path, context) => {
      if (context?.prev) queryClient.setQueryData(WORKSPACES_QUERY_KEY, context.prev);
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}><Plus className="w-4 h-4 mr-1.5" />Grant Trust</Button>
      </div>

      {showAdd && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Grant workspace trust</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">Enter the absolute path of the workspace directory. Future sessions using this path will auto-approve without a channel prompt.</p>
            <div className="flex gap-2">
              <Input placeholder="/path/to/workspace" value={newPath} onChange={e => setNewPath(e.target.value)} onKeyDown={e => e.key === "Enter" && trustMutation.mutate(newPath.trim())} className="font-mono text-sm" />
              <Button onClick={() => trustMutation.mutate(newPath.trim())} disabled={!newPath.trim() || trustMutation.isPending}>{trustMutation.isPending ? "Saving…" : "Grant"}</Button>
              <Button variant="ghost" onClick={() => { setShowAdd(false); setNewPath(""); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-medium flex items-center gap-2"><FolderCheck className="w-4 h-4 text-muted-foreground" />Recorded workspaces</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : !workspaces || workspaces.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No workspaces recorded yet. Grant trust to a directory above or start a session that requests workspace access.</div>
          ) : (
            <div className="divide-y">
              {workspaces.map(ws => {
                const isTrusted = Boolean(ws.trusted);
                return (
                  <div key={ws.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {isTrusted ? <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" /> : <ShieldOff className="w-4 h-4 text-muted-foreground shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-sm font-mono truncate" title={ws.path}>{ws.path}</p>
                        <p className="text-xs text-muted-foreground">{ws.actor ? `via ${ws.actor}` : ""}{ws.granted_at ? ` · ${new Date(ws.granted_at).toLocaleString()}` : ""}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={isTrusted ? "default" : "secondary"} className={isTrusted ? "bg-emerald-600 text-white" : ""}>{isTrusted ? "Trusted" : "Not trusted"}</Badge>
                      {isTrusted ? (
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => revokeMutation.mutate(ws.path)} disabled={revokeMutation.isPending}>Revoke</Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => trustMutation.mutate(ws.path)} disabled={trustMutation.isPending}>Trust</Button>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Remove Workspace</AlertDialogTitle><AlertDialogDescription>Permanently remove the record for "{ws.path}"? This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteMutation.mutate(ws.path)}>Remove</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


interface AgentEntry { id: number; name: string; version: string; description: string; capabilities: string[]; risk_tier: string; max_autonomy: string; enabled: boolean; created_at: string; }
const AGENTS_QUERY_KEY = ["/api/agents"];
const RISK_TIERS = ["low", "moderate", "high", "critical"] as const;
const AUTONOMY_MODES = ["off", "assist", "full"] as const;

function AgentsTab() {
  const { toast } = useToast();
  const { data: agents, isLoading } = useQuery<AgentEntry[]>({ queryKey: AGENTS_QUERY_KEY });
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", version: "1.0.0", description: "", capabilities: "", risk_tier: "moderate", max_autonomy: "assist" });
  const [editAgent, setEditAgent] = useState<AgentEntry | null>(null);
  const [editForm, setEditForm] = useState({ name: "", version: "", description: "", capabilities: "", risk_tier: "", max_autonomy: "" });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/agents", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY }); setShowCreate(false); setForm({ name: "", version: "1.0.0", description: "", capabilities: "", risk_tier: "moderate", max_autonomy: "assist" }); toast({ title: "Agent registered" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/agents/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY }); setEditAgent(null); toast({ title: "Agent updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => apiRequest("PATCH", `/api/agents/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/agents/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: AGENTS_QUERY_KEY }); toast({ title: "Agent removed" }); },
  });

  const parseCaps = (s: string) => s.split(",").map(c => c.trim()).filter(Boolean);

  const riskBadgeClass = (tier: string) => {
    const m: Record<string, string> = { low: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", moderate: "bg-amber-500/10 text-amber-700 dark:text-amber-300", high: "bg-orange-500/10 text-orange-700 dark:text-orange-300", critical: "bg-red-500/10 text-red-700 dark:text-red-300" };
    return m[tier] || "";
  };

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild><Button size="sm"><Plus className="w-3.5 h-3.5 mr-1" />Register Agent</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Register Agent Profile</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Name</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="my-agent" /></div>
                <div><Label className="text-xs">Version</Label><Input value={form.version} onChange={e => setForm(p => ({ ...p, version: e.target.value }))} /></div>
              </div>
              <div><Label className="text-xs">Description</Label><Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="What this agent does" /></div>
              <div><Label className="text-xs">Capabilities</Label><Input value={form.capabilities} onChange={e => setForm(p => ({ ...p, capabilities: e.target.value }))} placeholder="read_files, run_tests, deploy" /><p className="text-[10px] text-muted-foreground mt-0.5">Comma-separated</p></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Risk Tier</Label>
                  <Select value={form.risk_tier} onValueChange={v => setForm(p => ({ ...p, risk_tier: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{RISK_TIERS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
                </div>
                <div>
                  <Label className="text-xs">Max Autonomy</Label>
                  <Select value={form.max_autonomy} onValueChange={v => setForm(p => ({ ...p, max_autonomy: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{AUTONOMY_MODES.map(m => <SelectItem key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</SelectItem>)}</SelectContent></Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button onClick={() => createMutation.mutate({ ...form, capabilities: parseCaps(form.capabilities) })} disabled={!form.name || createMutation.isPending}>{createMutation.isPending ? "Creating..." : "Register"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {(!agents || agents.length === 0) ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <Sparkles className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No agent profiles registered. Register an agent to define risk tiers, autonomy caps, and capabilities.</p>
          </CardContent>
        </Card>
      ) : (
        agents.map(agent => (
          <Card key={agent.id} data-testid={`agent-profile-${agent.name}`} className={!agent.enabled ? "opacity-60" : ""}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  {agent.name}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">v{agent.version}</Badge>
                  <Badge variant="secondary" className={`text-[10px] ${riskBadgeClass(agent.risk_tier)}`}>{agent.risk_tier}</Badge>
                  <Switch checked={agent.enabled} onCheckedChange={checked => toggleMutation.mutate({ id: agent.id, enabled: checked })} />
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setEditAgent(agent); setEditForm({ name: agent.name, version: agent.version, description: agent.description, capabilities: agent.capabilities.join(", "), risk_tier: agent.risk_tier, max_autonomy: agent.max_autonomy }); }}><Pencil className="w-3 h-3" /></Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild><Button variant="ghost" size="sm" className="h-6 w-6 p-0"><Trash2 className="w-3 h-3 text-destructive" /></Button></AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader><AlertDialogTitle>Remove Agent</AlertDialogTitle><AlertDialogDescription>Remove "{agent.name}"?</AlertDialogDescription></AlertDialogHeader>
                      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteMutation.mutate(agent.id)}>Remove</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{agent.description}</p>
              <div>
                <span className="text-xs font-medium text-muted-foreground">Capabilities</span>
                <div className="flex flex-wrap gap-1 mt-1">{agent.capabilities.map(cap => <Badge key={cap} variant="secondary" className="text-[10px]">{cap}</Badge>)}</div>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>Max autonomy: <span className="font-medium text-foreground">{agent.max_autonomy}</span></span>
                <span>Registered: {ago(agent.created_at)}</span>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={!!editAgent} onOpenChange={open => { if (!open) setEditAgent(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Agent</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Name</Label><Input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><Label className="text-xs">Version</Label><Input value={editForm.version} onChange={e => setEditForm(p => ({ ...p, version: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Description</Label><Input value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} /></div>
            <div><Label className="text-xs">Capabilities</Label><Input value={editForm.capabilities} onChange={e => setEditForm(p => ({ ...p, capabilities: e.target.value }))} /><p className="text-[10px] text-muted-foreground mt-0.5">Comma-separated</p></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Risk Tier</Label><Select value={editForm.risk_tier} onValueChange={v => setEditForm(p => ({ ...p, risk_tier: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{RISK_TIERS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
              <div><Label className="text-xs">Max Autonomy</Label><Select value={editForm.max_autonomy} onValueChange={v => setEditForm(p => ({ ...p, max_autonomy: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{AUTONOMY_MODES.map(m => <SelectItem key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</SelectItem>)}</SelectContent></Select></div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={() => editAgent && updateMutation.mutate({ id: editAgent.id, data: { ...editForm, capabilities: parseCaps(editForm.capabilities) } })} disabled={!editForm.name || updateMutation.isPending}>{updateMutation.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DangerZoneTab() {
  const { toast } = useToast();
  const purgeMonitorMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/settings/purge-monitor-data", {}),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Monitor data purged", description: `Deleted ${data.sessions} sessions and ${data.messages} messages` });
      queryClient.invalidateQueries();
    },
    onError: () => toast({ title: "Failed to purge monitor data", variant: "destructive" }),
  });
  const purgeAllMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/settings/purge-all-data", {}),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "All data purged", description: `Cleared ${data.tables.length} tables` });
      queryClient.invalidateQueries();
    },
    onError: () => toast({ title: "Failed to purge data", variant: "destructive" }),
  });
  const resetMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/settings/reset", {}),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Settings reset", description: `Cleared ${data.tables.length} configuration tables` });
      queryClient.invalidateQueries();
    },
    onError: () => toast({ title: "Failed to reset settings", variant: "destructive" }),
  });

  const actions = [
    {
      title: "Delete Activity Data",
      description: "Remove all monitored conversation sessions and messages from browser, desktop, and VS Code monitors. This does not affect AtlasBridge session data.",
      confirmLabel: "Delete Activity Data",
      mutation: purgeMonitorMutation,
    },
    {
      title: "Delete All Dashboard Data",
      description: "Permanently delete all data stored by the dashboard including sessions, audit logs, scan results, and monitor data. This cannot be undone.",
      confirmLabel: "Delete All Data",
      mutation: purgeAllMutation,
    },
    {
      title: "Reset All Settings",
      description: "Reset all dashboard configuration to factory defaults. This clears saved providers, workspaces, and organization settings.",
      confirmLabel: "Reset Settings",
      mutation: resetMutation,
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive text-sm font-medium">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {actions.map((action) => (
            <div key={action.title} className="flex items-center justify-between gap-4 p-3 rounded-lg border border-destructive/20 bg-destructive/5">
              <div>
                <p className="text-sm font-medium">{action.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{action.description}</p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={action.mutation.isPending} data-testid={`button-${action.title.toLowerCase().replace(/\s+/g, "-")}`}>
                    {action.mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Trash2 className="w-3.5 h-3.5 mr-1" />}
                    {action.mutation.isPending ? "Processing..." : action.title}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                    <AlertDialogDescription>{action.description}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => action.mutation.mutate()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {action.confirmLabel}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Policy tab — live policy management
// ---------------------------------------------------------------------------

interface PolicyRule {
  id: string;
  description?: string;
  match?: Record<string, unknown>;
  action?: { type?: string; value?: string; [key: string]: unknown };
  enabled: boolean;
}

interface PolicyData {
  name: string | null;
  autonomy_mode: string | null;
  policy_version: string | null;
  rules: PolicyRule[];
  defaults: Record<string, unknown>;
  active: boolean;
}

interface PolicyPreset {
  file: string;
  name: string;
  autonomy_mode: string;
  policy_version: string;
  rule_count: number;
}

function actionColor(type: string): string {
  switch (type) {
    case "auto_reply": return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "require_human": return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "deny": return "bg-red-500/10 text-red-700 dark:text-red-400";
    case "notify_only": return "bg-blue-500/10 text-blue-700 dark:text-blue-400";
    default: return "bg-muted text-muted-foreground";
  }
}

function modeColor(mode: string): string {
  switch (mode) {
    case "full": return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "assist": return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "off": return "bg-red-500/10 text-red-700 dark:text-red-400";
    default: return "bg-muted text-muted-foreground";
  }
}

interface PolicyTestResult {
  action_type: string;
  action_value: string | null;
  matched_rule: string | null;
  explanation: string | null;
  summary: string;
}

function PolicyTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: policy, isLoading: policyLoading } = useQuery<PolicyData>({ queryKey: ["/api/policy"] });
  const { data: presets } = useQuery<PolicyPreset[]>({ queryKey: ["/api/policy/presets"] });
  const [selectedPreset, setSelectedPreset] = useState("");
  const [testPrompt, setTestPrompt] = useState("");
  const [testType, setTestType] = useState("yes_no");
  const [testConfidence, setTestConfidence] = useState("high");
  const [testResult, setTestResult] = useState<PolicyTestResult | null>(null);

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/policy/test", {
        prompt: testPrompt,
        type: testType,
        confidence: testConfidence,
      });
      return res.json() as Promise<PolicyTestResult>;
    },
    onSuccess: (data) => setTestResult(data),
    onError: (err: Error) => toast({ title: "Test failed", description: err.message, variant: "destructive" }),
  });

  const activateMutation = useMutation({
    mutationFn: (preset: string) => apiRequest("POST", "/api/policy/activate", { preset }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policy"] });
      toast({ title: "Policy activated", description: `Preset "${selectedPreset}" is now active` });
      setSelectedPreset("");
    },
    onError: (err: Error) => toast({ title: "Activation failed", description: err.message, variant: "destructive" }),
  });

  const modeMutation = useMutation({
    mutationFn: (mode: string) => apiRequest("POST", "/api/operator/mode", { mode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policy"] });
      toast({ title: "Autonomy mode changed" });
    },
    onError: (err: Error) => toast({ title: "Mode change failed", description: err.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) =>
      apiRequest("PATCH", `/api/policy/rules/${ruleId}/toggle`, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policy"] });
      toast({ title: "Rule updated" });
    },
    onError: (err: Error) => toast({ title: "Toggle failed", description: err.message, variant: "destructive" }),
  });

  const killMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/operator/kill-switch", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policy"] });
      toast({ title: "Kill switch activated", description: "Autopilot has been disabled" });
    },
    onError: (err: Error) => toast({ title: "Kill switch failed", description: err.message, variant: "destructive" }),
  });

  if (policyLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      {/* How it works */}
      <div className="flex items-start gap-2 p-3 rounded-md border bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900">
        <AlertCircle className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
        <div className="text-xs text-blue-800 dark:text-blue-300 space-y-1">
          <p className="font-medium">How policies work</p>
          <p>1. Pick a preset or customise rules below</p>
          <p>2. Use "Test a Prompt" to see what would happen</p>
          <p>3. Start a session (Sessions page) to enforce policies live</p>
        </div>
      </div>

      {/* Active policy card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />Active Policy
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!policy?.active ? (
            <p className="text-sm text-muted-foreground">No active policy. Select a preset below to get started.</p>
          ) : (
            <div className="flex items-center gap-4 flex-wrap">
              <div>
                <p className="text-sm font-medium">{policy.name}</p>
                <p className="text-xs text-muted-foreground">v{policy.policy_version} · {policy.rules.filter(r => r.enabled).length} active rules</p>
              </div>
              <Badge className={modeColor(policy.autonomy_mode ?? "off")} variant="secondary">
                {policy.autonomy_mode ?? "off"}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Autonomy mode + preset selector */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Autonomy mode */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Power className="w-4 h-4" />Autonomy Mode
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Controls how the daemon handles prompts. Off = all to human, Assist = suggest + confirm, Full = auto-execute.
            </p>
            <div className="flex gap-2">
              {["off", "assist", "full"].map(mode => (
                <Button
                  key={mode}
                  variant={policy?.autonomy_mode === mode ? "default" : "outline"}
                  size="sm"
                  onClick={() => modeMutation.mutate(mode)}
                  disabled={modeMutation.isPending}
                  data-testid={`button-mode-${mode}`}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Preset selector */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileCheck className="w-4 h-4" />Policy Presets
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Switch to a pre-configured policy. This replaces the active policy entirely.
            </p>
            <div className="flex gap-2">
              <Select value={selectedPreset} onValueChange={setSelectedPreset}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select a preset..." />
                </SelectTrigger>
                <SelectContent>
                  {(presets ?? []).map(p => (
                    <SelectItem key={p.file} value={p.file}>
                      {p.name} ({p.autonomy_mode}, {p.rule_count} rules)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    disabled={!selectedPreset || activateMutation.isPending}
                    data-testid="button-activate-preset"
                  >
                    {activateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Activate"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Activate preset policy?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will replace the current active policy with <strong>{selectedPreset}</strong>.
                      All custom rule toggles will be reset. The change takes effect on the next prompt evaluation.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => activateMutation.mutate(selectedPreset)}>
                      Activate
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Kill switch */}
      <Card className="border-red-200 dark:border-red-900">
        <CardContent className="p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-red-700 dark:text-red-400">Emergency Kill Switch</p>
            <p className="text-xs text-muted-foreground">Immediately disables autopilot. All prompts will require manual human input.</p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={killMutation.isPending} data-testid="button-kill-switch">
                <ShieldOff className="w-3.5 h-3.5 mr-1.5" />Kill Switch
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Activate kill switch?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will immediately disable autopilot. All prompts will require manual human input until you re-enable autopilot.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => killMutation.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Disable Autopilot
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      {/* Test a prompt */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Eye className="w-4 h-4" />Test a Prompt
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Type a sample prompt to see which rule matches and what AtlasBridge would do.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder='e.g. "Continue? [y/n]" or "Enter your API key:"'
              value={testPrompt}
              onChange={e => { setTestPrompt(e.target.value); setTestResult(null); }}
              className="flex-1"
              data-testid="input-test-prompt"
            />
            <Select value={testType} onValueChange={v => { setTestType(v); setTestResult(null); }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes_no">Yes / No</SelectItem>
                <SelectItem value="confirm_enter">Press Enter</SelectItem>
                <SelectItem value="free_text">Free Text</SelectItem>
                <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
              </SelectContent>
            </Select>
            <Select value={testConfidence} onValueChange={v => { setTestConfidence(v); setTestResult(null); }}>
              <SelectTrigger className="w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={() => testMutation.mutate()}
              disabled={!testPrompt.trim() || testMutation.isPending}
              data-testid="button-test-policy"
            >
              {testMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Test"}
            </Button>
          </div>
          {testResult && (
            <div className={`p-3 rounded-md border ${
              testResult.action_type === "auto_reply" ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900" :
              testResult.action_type === "deny" ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900" :
              testResult.action_type === "require_human" ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900" :
              "bg-muted/30 border-border"
            }`} data-testid="test-result">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="secondary" className={`text-[10px] ${actionColor(testResult.action_type)}`}>
                  {testResult.action_type.replace(/_/g, " ")}
                </Badge>
                {testResult.matched_rule && (
                  <span className="text-[10px] text-muted-foreground">rule: {testResult.matched_rule}</span>
                )}
              </div>
              <p className="text-sm font-medium">{testResult.summary}</p>
              {testResult.explanation && (
                <p className="text-xs text-muted-foreground mt-1">{testResult.explanation}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rules list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Policy Rules</CardTitle>
        </CardHeader>
        <CardContent>
          {(!policy?.rules || policy.rules.length === 0) ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No rules defined. Activate a preset to get started.</p>
          ) : (
            <div className="space-y-2">
              {policy.rules.map(rule => {
                const actionType = rule.action?.type ?? "unknown";
                const matchTypes = Array.isArray(rule.match?.prompt_type) ? (rule.match.prompt_type as string[]).join(", ") : null;
                const matchContains = typeof rule.match?.contains === "string" ? rule.match.contains : null;
                const matchConfidence = typeof rule.match?.min_confidence === "string" ? rule.match.min_confidence : null;

                return (
                  <div
                    key={rule.id}
                    className={`flex items-center gap-3 p-3 rounded-md border transition-colors ${rule.enabled ? "bg-card hover:bg-muted/30" : "bg-muted/20 opacity-60"}`}
                    data-testid={`rule-${rule.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-xs font-mono font-medium">{rule.id}</code>
                        <Badge variant="secondary" className={`text-[10px] ${actionColor(actionType)}`}>
                          {actionType.replace(/_/g, " ")}
                        </Badge>
                        {matchConfidence && (
                          <Badge variant="outline" className="text-[10px]">
                            {matchConfidence}+
                          </Badge>
                        )}
                      </div>
                      {rule.description && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">{rule.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {matchTypes && (
                          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            types: {matchTypes}
                          </span>
                        )}
                        {matchContains && (
                          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono truncate max-w-[200px]">
                            /{matchContains}/
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => toggleMutation.mutate({ ruleId: rule.id, enabled: !rule.enabled })}
                      disabled={toggleMutation.isPending}
                      className="shrink-0 p-1 rounded hover:bg-muted transition-colors"
                      title={rule.enabled ? "Disable rule" : "Enable rule"}
                      data-testid={`toggle-${rule.id}`}
                    >
                      {rule.enabled
                        ? <ToggleRight className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                        : <ToggleLeft className="w-6 h-6 text-muted-foreground" />
                      }
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  const { data: settings, isLoading: settingsLoading } = useQuery<SettingsData>({ queryKey: ["/api/settings"] });
  const { data: orgData, isLoading: orgLoading } = useQuery<OrgSettingsData>({ queryKey: ORG_QUERY_KEY });

  if (settingsLoading || orgLoading) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-xl font-semibold tracking-tight">Settings</h1><p className="text-sm text-muted-foreground mt-1">Loading configuration...</p></div>
        <Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!settings || !orgData) return null;

  return (
    <div className="space-y-6">
      <div><h1 className="text-xl font-semibold tracking-tight">Settings</h1><p className="text-sm text-muted-foreground mt-1">Organization configuration and management</p></div>

      <Tabs defaultValue="general" className="space-y-4">
        <div className="overflow-x-auto">
          <TabsList className="inline-flex w-auto" data-testid="settings-tabs">
            <TabsTrigger value="general" data-testid="tab-general"><Server className="w-3.5 h-3.5 mr-1.5" />General</TabsTrigger>
            <TabsTrigger value="security" data-testid="tab-security"><ShieldCheck className="w-3.5 h-3.5 mr-1.5" />Security</TabsTrigger>
            <TabsTrigger value="retention" data-testid="tab-retention"><FileCheck className="w-3.5 h-3.5 mr-1.5" />Retention</TabsTrigger>
            <TabsTrigger value="notifications" data-testid="tab-notifications"><Bell className="w-3.5 h-3.5 mr-1.5" />Alerts</TabsTrigger>
            <TabsTrigger value="authentication" data-testid="tab-authentication"><Fingerprint className="w-3.5 h-3.5 mr-1.5" />Authentication</TabsTrigger>
            <TabsTrigger value="providers" data-testid="tab-providers"><Key className="w-3.5 h-3.5 mr-1.5" />Providers</TabsTrigger>
            <TabsTrigger value="workspaces" data-testid="tab-workspaces"><FolderCheck className="w-3.5 h-3.5 mr-1.5" />Workspaces</TabsTrigger>
            <TabsTrigger value="policy" data-testid="tab-policy"><Shield className="w-3.5 h-3.5 mr-1.5" />Policy</TabsTrigger>
            <TabsTrigger value="agents" data-testid="tab-agents"><Sparkles className="w-3.5 h-3.5 mr-1.5" />Agents</TabsTrigger>
            <TabsTrigger value="danger" data-testid="tab-danger" className="text-destructive data-[state=active]:text-destructive"><Trash2 className="w-3.5 h-3.5 mr-1.5" />Danger Zone</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="general"><GeneralTab data={settings} /></TabsContent>
        <TabsContent value="security"><SecurityTab org={orgData} /></TabsContent>
        <TabsContent value="retention"><RetentionTab /></TabsContent>
        <TabsContent value="notifications"><NotificationsTab org={orgData} /></TabsContent>
        <TabsContent value="authentication"><AuthenticationTab /></TabsContent>
        <TabsContent value="providers"><ProvidersTab /></TabsContent>
        <TabsContent value="workspaces"><WorkspacesTab /></TabsContent>
        <TabsContent value="policy"><PolicyTab /></TabsContent>
        <TabsContent value="agents"><AgentsTab /></TabsContent>
        <TabsContent value="danger"><DangerZoneTab /></TabsContent>
      </Tabs>
    </div>
  );
}
