import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ScrollText, Plus, GripVertical, ToggleLeft, ToggleRight, Trash2,
  Play, Save, FileCode, Eye, Copy, Check, AlertCircle, ChevronDown,
  ChevronRight, Wand2, Download, Shield, ShieldCheck, ShieldAlert,
  Zap, HelpCircle, BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PolicyAction {
  type: string;
  value?: string;
  message?: string;
  reason?: string;
  constraints?: Record<string, unknown>;
}

interface PolicyRule {
  id: string;
  description?: string;
  match: {
    tool_id?: string;
    prompt_type?: string[];
    contains?: string;
    contains_is_regex?: boolean;
    min_confidence?: string;
    repo?: string;
  };
  action: PolicyAction;
  enabled?: boolean;
  max_auto_replies?: number;
}

interface PolicyData {
  policy_version: string;
  name: string;
  autonomy_mode: string;
  rules: PolicyRule[];
  defaults?: Record<string, unknown>;
  raw?: string;
}

interface PolicyPresetRaw {
  name: string;
  // Server may return either shape depending on build
  file?: string;
  filename?: string;
  mode?: string;
  autonomy_mode?: string;
  ruleCount?: number;
  rule_count?: number;
  description?: string;
  content?: string;
  policy_version?: string;
}

interface PolicyPreset {
  name: string;
  filename: string;
  mode: string;
  ruleCount: number;
  description: string;
  content: string;
}

function normalizePreset(raw: PolicyPresetRaw): PolicyPreset {
  return {
    name: raw.name,
    filename: raw.filename || raw.file || "",
    mode: raw.mode || raw.autonomy_mode || "off",
    ruleCount: raw.ruleCount ?? raw.rule_count ?? 0,
    description: raw.description || "",
    content: raw.content || "",
  };
}

interface PolicyTestResult {
  matched: boolean;
  ruleId?: string;
  action?: string;
  value?: string;
  explanation: string;
}

// ---------------------------------------------------------------------------
// Preset metadata — human-friendly descriptions for each real preset
// ---------------------------------------------------------------------------

const PRESET_META: Record<string, {
  emoji: string;
  title: string;
  subtitle: string;
  bullets: string[];
  color: string;
  borderColor: string;
  recommended?: boolean;
}> = {
  "escalation-only.yaml": {
    emoji: "🛑",
    title: "Ask me everything",
    subtitle: "Nothing happens without your say-so",
    bullets: [
      "Every question the AI asks gets sent to you",
      "You see it and type your answer",
      "The safest option — start here if unsure",
    ],
    color: "bg-slate-500/10",
    borderColor: "border-slate-500/30 hover:border-slate-500/50",
  },
  "minimal.yaml": {
    emoji: "👋",
    title: "Handle the basics",
    subtitle: "Auto-press Enter, ask me the rest",
    bullets: [
      "Automatically presses Enter on \"Press Enter to continue\"",
      "Everything else still comes to you for approval",
      "A small step up — saves you from trivial confirmations",
    ],
    color: "bg-blue-500/10",
    borderColor: "border-blue-500/30 hover:border-blue-500/50",
  },
  "assist-mode.yaml": {
    emoji: "🤝",
    title: "Smart assistant",
    subtitle: "Auto-handle safe stuff, ask me for the rest",
    bullets: [
      "Auto-presses Enter, auto-answers \"Continue? [y/n]\" with yes",
      "Blocks password and API key prompts automatically",
      "Sends you anything destructive or unfamiliar",
    ],
    color: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30 hover:border-emerald-500/50",
    recommended: true,
  },
  "full-mode-safe.yaml": {
    emoji: "⚡",
    title: "Full autopilot",
    subtitle: "Handle most things, only ask me for risky stuff",
    bullets: [
      "Auto-answers confirmations, test prompts, installs",
      "Blocks credentials and force-push automatically",
      "Only asks you about destructive operations",
    ],
    color: "bg-amber-500/10",
    borderColor: "border-amber-500/30 hover:border-amber-500/50",
  },
};

// ---------------------------------------------------------------------------
// Setup Wizard — interactive, layman-friendly
// ---------------------------------------------------------------------------

const WIZARD_STEPS = [
  { label: "How it works", id: "intro" },
  { label: "Pick a level", id: "preset" },
  { label: "Test it", id: "test" },
] as const;

function WizardStepIndicator({ current, onNavigate }: { current: number; onNavigate: (i: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {WIZARD_STEPS.map((step, i) => (
        <div key={step.id} className="flex items-center gap-2">
          <button
            onClick={() => onNavigate(i)}
            className={cn(
              "flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-all",
              i < current
                ? "bg-primary text-primary-foreground"
                : i === current
                  ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            {i < current ? <Check className="w-4 h-4" /> : i + 1}
          </button>
          <span
            className={cn(
              "text-xs hidden sm:inline",
              i <= current ? "text-foreground font-medium" : "text-muted-foreground",
            )}
          >
            {step.label}
          </span>
          {i < WIZARD_STEPS.length - 1 && (
            <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
          )}
        </div>
      ))}
    </div>
  );
}

function PolicyWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [testPrompt, setTestPrompt] = useState("");
  const [testResult, setTestResult] = useState<PolicyTestResult | null>(null);

  const { data: presets, isLoading: presetsLoading, error: presetsError } = useQuery({
    queryKey: ["/api/policy/presets"],
    staleTime: 60_000,
    select: (data: PolicyPresetRaw[]) => data.map(normalizePreset),
  });

  const activateMutation = useMutation({
    mutationFn: (filename: string) => apiRequest("POST", "/api/policy/activate", { preset: filename }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policy"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
      setStep(2);
    },
  });

  const testMutation = useMutation({
    mutationFn: async (data: { prompt: string; promptType: string; confidence: string }) => {
      const res = await apiRequest("POST", "/api/policy/test", data);
      const raw = await res.json();
      return {
        matched: !!raw.matched_rule,
        ruleId: raw.matched_rule ?? undefined,
        action: raw.action_type ?? undefined,
        explanation: raw.summary || raw.explanation || "",
      } as PolicyTestResult;
    },
    onSuccess: (data) => setTestResult(data),
  });

  const next = () => setStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  // Order presets to match our preferred display order
  const presetOrder = ["escalation-only.yaml", "minimal.yaml", "assist-mode.yaml", "full-mode-safe.yaml"];
  const orderedPresets = presetOrder
    .map(fn => (presets || []).find(p => p.filename === fn))
    .filter(Boolean) as PolicyPreset[];

  return (
    <div className="space-y-4">
      <WizardStepIndicator current={step} onNavigate={setStep} />

      {/* Step 0: How it works */}
      {step === 0 && (
        <div className="max-w-xl mx-auto space-y-6">
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                <ScrollText className="w-7 h-7 text-primary" />
              </div>
            </div>
            <h2 className="text-xl font-semibold tracking-tight">How policies work</h2>
            <p className="text-sm text-muted-foreground mt-3 leading-relaxed max-w-md mx-auto">
              When your AI tool runs, it sometimes pauses and asks a question — like
              "Continue?" or "Enter your API key". A policy tells AtlasBridge
              what to do with each question.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-start gap-4 p-4 rounded-lg border bg-card">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                <Eye className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm font-medium">AtlasBridge catches the question</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  It watches your AI tool and intercepts every question it asks.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 rounded-lg border bg-card">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                <Wand2 className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <p className="text-sm font-medium">It checks your policy</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Your policy is a list of rules. Each rule says: "if the question looks like X, do Y."
                  It goes through the list top-to-bottom until it finds a match.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 rounded-lg border bg-card">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                <Zap className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm font-medium">It takes action</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Depending on the rule, it can: answer automatically, ask you first,
                  or block the question entirely. You're always in control.
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={next} className="gap-2">
              Pick your comfort level <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 1: Pick a preset */}
      {step === 1 && (
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="text-center">
            <h2 className="text-xl font-semibold tracking-tight">How much should AtlasBridge handle on its own?</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Pick the level you're comfortable with. You can change this any time.
            </p>
          </div>

          {presetsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
            </div>
          ) : presetsError ? (
            <div className="flex items-start gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-red-700 dark:text-red-400">Could not load presets</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {presetsError instanceof Error ? presetsError.message : "Check that the dashboard server is running."}
                </p>
              </div>
            </div>
          ) : orderedPresets.length === 0 ? (
            <div className="flex items-start gap-2 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400">No presets found</p>
                <p className="text-xs text-muted-foreground mt-1">
                  The preset policy files were not found. Make sure AtlasBridge is installed correctly.
                </p>
                {presets && presets.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Found {presets.length} file(s) but none matched expected presets.
                    Files: {presets.map(p => p.filename).join(", ")}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {orderedPresets.map((preset) => {
                const meta = PRESET_META[preset.filename];
                if (!meta) return null;
                const isSelected = selectedPreset === preset.filename;

                return (
                  <button
                    key={preset.filename}
                    onClick={() => setSelectedPreset(preset.filename)}
                    className={cn(
                      "relative text-left p-4 rounded-xl border-2 transition-all",
                      meta.borderColor,
                      isSelected && "ring-2 ring-primary border-primary",
                    )}
                  >
                    {meta.recommended && (
                      <Badge className="absolute -top-2.5 right-3 bg-emerald-600 text-white text-[9px]">
                        Recommended
                      </Badge>
                    )}
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xl">{meta.emoji}</span>
                      <div>
                        <p className="text-sm font-semibold">{meta.title}</p>
                        <p className="text-[11px] text-muted-foreground">{meta.subtitle}</p>
                      </div>
                    </div>
                    <ul className="space-y-1.5 ml-1">
                      {meta.bullets.map((b, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                          <span className="text-primary mt-0.5 shrink-0">•</span>
                          {b}
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
                      <span className="text-[10px] text-muted-foreground">{preset.ruleCount} rules</span>
                      <Badge variant="outline" className="text-[10px]">{preset.mode}</Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {activateMutation.isError && (
            <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 dark:text-red-400">
                {activateMutation.error instanceof Error ? activateMutation.error.message : "Failed to activate"}
              </p>
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="ghost" onClick={back} className="gap-2">
              <ChevronRight className="w-4 h-4 rotate-180" /> Back
            </Button>
            <Button
              onClick={() => selectedPreset && activateMutation.mutate(selectedPreset)}
              disabled={!selectedPreset || activateMutation.isPending}
              className="gap-2"
            >
              {activateMutation.isPending ? "Activating..." : "Activate & continue"}
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Test it */}
      {step === 2 && (
        <div className="max-w-xl mx-auto space-y-6">
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                <ShieldCheck className="w-7 h-7 text-emerald-500" />
              </div>
            </div>
            <h2 className="text-xl font-semibold tracking-tight">Your policy is active!</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Try it out — click a question below to see how your policy handles it.
            </p>
          </div>

          {/* Quick test scenarios */}
          <div className="space-y-2">
            {[
              { label: "\"Continue? [y/n]\"", prompt: "Continue? [y/n]", type: "yes_no", conf: "high",
                hint: "A common safe question — most policies auto-answer yes" },
              { label: "\"Delete these files?\"", prompt: "Are you sure you want to delete these files?", type: "yes_no", conf: "high",
                hint: "A risky question — good policies ask you first" },
              { label: "\"Enter your API key:\"", prompt: "Please enter your API key:", type: "free_text", conf: "high",
                hint: "A credential question — should be blocked" },
              { label: "\"Press Enter to continue\"", prompt: "Press Enter to continue...", type: "confirm_enter", conf: "high",
                hint: "A trivial confirmation — usually auto-pressed" },
            ].map((qt) => (
              <button
                key={qt.label}
                onClick={() => {
                  setTestPrompt(qt.prompt);
                  testMutation.mutate({ prompt: qt.prompt, promptType: qt.type, confidence: qt.conf });
                }}
                className="w-full text-left p-3 rounded-lg border hover:border-primary/30 hover:bg-muted/50 transition-all"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{qt.label}</span>
                  {testMutation.isPending && testPrompt === qt.prompt && (
                    <span className="text-[10px] text-muted-foreground animate-pulse">testing...</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{qt.hint}</p>
              </button>
            ))}
          </div>

          {/* Result */}
          {testResult && (
            <Card className={testResult.matched
              ? testResult.action === "deny" ? "border-red-500/30" : testResult.action === "require_human" ? "border-amber-500/30" : "border-emerald-500/30"
              : "border-amber-500/30"
            }>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  {testResult.action === "auto_reply" && <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">Auto-answered</Badge>}
                  {testResult.action === "require_human" && <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400">Asks you first</Badge>}
                  {testResult.action === "deny" && <Badge className="bg-red-500/10 text-red-700 dark:text-red-400">Blocked</Badge>}
                  {testResult.action === "notify_only" && <Badge className="bg-blue-500/10 text-blue-700 dark:text-blue-400">Logged only</Badge>}
                  {!testResult.matched && <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400">No rule matched — asks you</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{testResult.explanation}</p>
              </CardContent>
            </Card>
          )}

          {testMutation.isError && (
            <Card className="border-red-500/30">
              <CardContent className="p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    {testMutation.error instanceof Error ? testMutation.error.message : "Test failed. Make sure a policy is active."}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-between">
            <Button variant="ghost" onClick={back} className="gap-2">
              <ChevronRight className="w-4 h-4 rotate-180" /> Back
            </Button>
            <Button onClick={onDone} className="gap-2">
              Done — go to rules <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Visual Rule Editor
// ---------------------------------------------------------------------------

function RuleCard({
  rule,
  index,
  isExpanded,
  onToggleExpand,
  onDelete,
  onToggleEnabled,
  enabled,
}: {
  rule: PolicyRule;
  index: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  enabled: boolean;
}) {
  const actionColors: Record<string, string> = {
    auto_reply: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    require_human: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    deny: "bg-red-500/10 text-red-700 dark:text-red-400",
    notify_only: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  };

  const actionLabels: Record<string, string> = {
    auto_reply: "auto answer",
    require_human: "ask you",
    deny: "block",
    notify_only: "log only",
  };

  return (
    <Card className={cn("transition-all", !enabled && "opacity-50")}>
      <CardContent className="p-0">
        {/* Rule header (always visible) */}
        <div className="flex items-center gap-3 p-4">
          <GripVertical className="w-4 h-4 text-muted-foreground/50 cursor-grab shrink-0" />

          <button onClick={onToggleExpand} className="flex-1 text-left flex items-center gap-3 min-w-0">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-mono">#{index + 1}</span>
                <span className="text-sm font-medium truncate">{rule.id}</span>
              </div>
              {rule.description && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">{rule.description}</p>
              )}
            </div>
          </button>

          <Badge className={cn("text-[10px] shrink-0", actionColors[rule.action.type] || "")}>
            {actionLabels[rule.action.type] || rule.action.type}
          </Badge>

          <button
            onClick={onToggleEnabled}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            aria-label={enabled ? "Disable rule" : "Enable rule"}
          >
            {enabled ? (
              <ToggleRight className="w-5 h-5 text-primary" />
            ) : (
              <ToggleLeft className="w-5 h-5" />
            )}
          </button>

          <button
            onClick={onDelete}
            className="text-muted-foreground hover:text-red-500 transition-colors shrink-0"
            aria-label="Delete rule"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Expanded detail */}
        {isExpanded && (
          <div className="px-4 pb-4 space-y-3 border-t pt-3">
            {/* Match criteria */}
            <div>
              <Label className="text-xs font-medium text-muted-foreground">When the question matches</Label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {rule.match.prompt_type?.map((t) => (
                  <Badge key={t} variant="secondary" className="text-[10px] font-mono">{t}</Badge>
                ))}
                {rule.match.contains && (
                  <Badge variant="secondary" className="text-[10px] font-mono">
                    contains: {rule.match.contains}
                  </Badge>
                )}
                {rule.match.min_confidence && (
                  <Badge variant="secondary" className="text-[10px]">
                    confidence ≥ {rule.match.min_confidence}
                  </Badge>
                )}
                {!rule.match.prompt_type?.length && !rule.match.contains && !rule.match.min_confidence && (
                  <Badge variant="secondary" className="text-[10px]">catch-all (matches everything)</Badge>
                )}
              </div>
            </div>

            {/* Action detail */}
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Then do this</Label>
              <div className="flex items-center gap-2 mt-1.5">
                <Badge className={cn("text-[10px]", actionColors[rule.action.type] || "")}>
                  {actionLabels[rule.action.type] || rule.action.type}
                </Badge>
                {rule.action.value && (
                  <span className="text-xs font-mono text-muted-foreground">
                    with: {rule.action.value === "\n" ? "↵ Enter" : `"${rule.action.value}"`}
                  </span>
                )}
              </div>
            </div>

            {rule.action.message && (
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Message shown to you</Label>
                <p className="mt-1 text-xs text-muted-foreground">{rule.action.message}</p>
              </div>
            )}
            {rule.action.reason && (
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Reason</Label>
                <p className="mt-1 text-xs text-muted-foreground">{rule.action.reason}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// YAML Editor
// ---------------------------------------------------------------------------

function YamlEditor({
  yaml,
  onChange,
  onSave,
  saving,
  error,
}: {
  yaml: string;
  onChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  error?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">YAML Editor</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              navigator.clipboard.writeText(yaml);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="gap-1.5"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving} className="gap-1.5">
            <Save className="w-3.5 h-3.5" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <textarea
        value={yaml}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-[500px] font-mono text-xs bg-muted/50 border rounded-lg p-4 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
        spellCheck={false}
        data-testid="yaml-editor"
      />

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presets Tab — one-step deployment
// ---------------------------------------------------------------------------

function PresetsPanel() {
  const [activated, setActivated] = useState<string | null>(null);

  const { data: presets, isLoading } = useQuery({
    queryKey: ["/api/policy/presets"],
    staleTime: 60_000,
    select: (data: PolicyPresetRaw[]) => data.map(normalizePreset),
  });

  const { data: policyData } = useQuery<PolicyData>({
    queryKey: ["/api/policy"],
    staleTime: 10_000,
  });

  const activateMutation = useMutation({
    mutationFn: (filename: string) => apiRequest("POST", "/api/policy/activate", { preset: filename }),
    onSuccess: (_data, filename) => {
      setActivated(filename);
      queryClient.invalidateQueries({ queryKey: ["/api/policy"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
    },
  });

  const presetOrder = ["escalation-only.yaml", "minimal.yaml", "assist-mode.yaml", "full-mode-safe.yaml"];
  const orderedPresets = presetOrder
    .map(fn => (presets || []).find(p => p.filename === fn))
    .filter(Boolean) as PolicyPreset[];

  // Match active policy name to a preset
  const activeName = policyData?.name;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-medium">Pick a preset and activate it in one step</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Each preset is a ready-to-use set of rules. Click activate and it takes effect immediately.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
        </div>
      ) : orderedPresets.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No presets found. Make sure AtlasBridge is installed correctly.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {orderedPresets.map((preset) => {
            const meta = PRESET_META[preset.filename];
            if (!meta) return null;
            const isActive = activeName === preset.name;
            const justActivated = activated === preset.filename;

            return (
              <Card
                key={preset.filename}
                className={cn(
                  "relative transition-all",
                  isActive ? "border-primary ring-1 ring-primary/20" : meta.borderColor,
                )}
              >
                {meta.recommended && !isActive && (
                  <Badge className="absolute -top-2.5 right-3 bg-emerald-600 text-white text-[9px]">
                    Recommended
                  </Badge>
                )}
                {isActive && (
                  <Badge className="absolute -top-2.5 right-3 bg-primary text-primary-foreground text-[9px]">
                    Active
                  </Badge>
                )}
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{meta.emoji}</span>
                    <div>
                      <p className="text-sm font-semibold">{meta.title}</p>
                      <p className="text-[11px] text-muted-foreground">{meta.subtitle}</p>
                    </div>
                  </div>

                  <ul className="space-y-1.5">
                    {meta.bullets.map((b, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                        <span className="text-primary mt-0.5 shrink-0">•</span>
                        {b}
                      </li>
                    ))}
                  </ul>

                  <div className="flex items-center justify-between pt-2 border-t border-border/50">
                    <span className="text-[10px] text-muted-foreground">{preset.ruleCount} rules · {preset.mode} mode</span>
                    {isActive ? (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <Check className="w-3 h-3" /> Active
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => activateMutation.mutate(preset.filename)}
                        disabled={activateMutation.isPending}
                        className="gap-1.5"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        {activateMutation.isPending ? "Activating..." : "Activate"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {activated && (
        <div className="flex items-start gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
          <p className="text-xs text-emerald-700 dark:text-emerald-400">
            Policy activated. It takes effect immediately for all new prompts.
          </p>
        </div>
      )}

      {activateMutation.isError && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700 dark:text-red-400">
            {activateMutation.error instanceof Error ? activateMutation.error.message : "Failed to activate preset"}
          </p>
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Test Tab — simplified
// ---------------------------------------------------------------------------

function TestTab() {
  const [prompt, setPrompt] = useState("");
  const [promptType, setPromptType] = useState("yes_no");
  const [confidence, setConfidence] = useState("high");
  const [result, setResult] = useState<PolicyTestResult | null>(null);

  const testMutation = useMutation({
    mutationFn: async (data: { prompt: string; promptType: string; confidence: string }) => {
      const res = await apiRequest("POST", "/api/policy/test", data);
      const raw = await res.json();
      return {
        matched: !!raw.matched_rule,
        ruleId: raw.matched_rule ?? undefined,
        action: raw.action_type ?? undefined,
        explanation: raw.summary || raw.explanation || "",
      } as PolicyTestResult;
    },
    onSuccess: (data) => setResult(data),
  });

  const runTest = (p: string, type: string, conf: string) => {
    setPrompt(p);
    setPromptType(type);
    setConfidence(conf);
    testMutation.mutate({ prompt: p, promptType: type, confidence: conf });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Test how your policy handles different questions. Click a scenario or type your own.
      </p>

      {/* Quick scenarios */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {[
          { label: "\"Continue? [y/n]\"", prompt: "Continue? [y/n]", type: "yes_no", conf: "high",
            hint: "Common safe question" },
          { label: "\"Delete these files?\"", prompt: "Are you sure you want to delete these files?", type: "yes_no", conf: "high",
            hint: "Risky — should ask you" },
          { label: "\"Enter your API key:\"", prompt: "Please enter your API key:", type: "free_text", conf: "high",
            hint: "Credential — should block" },
          { label: "\"Press Enter\"", prompt: "Press Enter to continue...", type: "confirm_enter", conf: "high",
            hint: "Trivial confirmation" },
          { label: "\"Select option:\"", prompt: "1) npm install\n2) pip install\n3) Skip", type: "multiple_choice", conf: "medium",
            hint: "Multiple choice" },
          { label: "\"Enter branch name:\"", prompt: "Enter branch name:", type: "free_text", conf: "medium",
            hint: "Free text input" },
        ].map((qt) => (
          <button
            key={qt.label}
            onClick={() => runTest(qt.prompt, qt.type, qt.conf)}
            className="text-left p-3 rounded-lg border hover:border-primary/30 hover:bg-muted/50 transition-all"
          >
            <span className="text-xs font-medium">{qt.label}</span>
            <p className="text-[11px] text-muted-foreground mt-0.5">{qt.hint}</p>
          </button>
        ))}
      </div>

      {/* Custom test */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs font-medium">Custom test</p>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2">
              <Label className="text-xs">Question text</Label>
              <Input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder='e.g., "Continue? [y/n]"'
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={promptType} onValueChange={setPromptType}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes_no">yes / no</SelectItem>
                  <SelectItem value="confirm_enter">press Enter</SelectItem>
                  <SelectItem value="multiple_choice">pick from list</SelectItem>
                  <SelectItem value="free_text">type something</SelectItem>
                  <SelectItem value="tool_use">tool approval</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Certainty</Label>
              <Select value={confidence} onValueChange={setConfidence}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">high</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="low">low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            onClick={() => testMutation.mutate({ prompt, promptType, confidence })}
            disabled={!prompt || testMutation.isPending}
            className="gap-2"
          >
            <Play className="w-4 h-4" />
            {testMutation.isPending ? "Testing..." : "Test"}
          </Button>
        </CardContent>
      </Card>

      {/* Result */}
      {result && (
        <Card className={result.matched
          ? result.action === "deny" ? "border-red-500/30" : result.action === "require_human" ? "border-amber-500/30" : "border-emerald-500/30"
          : "border-amber-500/30"
        }>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              {result.action === "auto_reply" && <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">Auto-answered</Badge>}
              {result.action === "require_human" && <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400">Asks you first</Badge>}
              {result.action === "deny" && <Badge className="bg-red-500/10 text-red-700 dark:text-red-400">Blocked</Badge>}
              {result.action === "notify_only" && <Badge className="bg-blue-500/10 text-blue-700 dark:text-blue-400">Logged only</Badge>}
              {!result.matched && <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400">No rule matched — asks you</Badge>}
              {result.ruleId && (
                <span className="text-[10px] text-muted-foreground font-mono">rule: {result.ruleId}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{result.explanation}</p>
          </CardContent>
        </Card>
      )}

      {testMutation.isError && (
        <Card className="border-red-500/30">
          <CardContent className="p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                {testMutation.error instanceof Error ? testMutation.error.message : "No active policy. Use the setup guide to pick one first."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Decision History Tab
// ---------------------------------------------------------------------------

function DecisionHistory() {
  const { data, isLoading } = useQuery<Array<{
    timestamp: string;
    prompt_text: string;
    matched_rule_id: string;
    action_type: string;
    session_id: string;
    confidence: string;
  }>>({
    queryKey: ["/api/traces"],
    refetchInterval: 5_000,
  });

  if (isLoading) {
    return <Skeleton className="h-64" />;
  }

  const decisions = data || [];

  if (decisions.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No decisions yet. Decisions appear here when AtlasBridge evaluates questions from your AI tools.
          </p>
        </CardContent>
      </Card>
    );
  }

  const actionLabels: Record<string, string> = {
    auto_reply: "auto-answered",
    require_human: "asked you",
    deny: "blocked",
    notify_only: "logged",
  };

  const actionColors: Record<string, string> = {
    auto_reply: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    require_human: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    deny: "bg-red-500/10 text-red-700 dark:text-red-400",
    notify_only: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Recent decisions. Each row shows a question your AI tool asked and what happened.
      </p>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left p-3 font-medium text-muted-foreground">Time</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Question</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Rule</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Result</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Certainty</th>
              </tr>
            </thead>
            <tbody>
              {decisions.slice(0, 50).map((d, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-3 text-muted-foreground whitespace-nowrap">
                    {new Date(d.timestamp).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}
                  </td>
                  <td className="p-3 max-w-[300px] truncate" title={d.prompt_text}>
                    {d.prompt_text}
                  </td>
                  <td className="p-3 font-mono text-muted-foreground">{d.matched_rule_id || "—"}</td>
                  <td className="p-3">
                    <Badge className={cn("text-[10px]", actionColors[d.action_type] || "")}>
                      {actionLabels[d.action_type] || d.action_type}
                    </Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">{d.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Main Policy Page
// ---------------------------------------------------------------------------

const NEW_RULE_TEMPLATE = `
  - id: new-rule
    description: "Describe what this rule does"
    match:
      prompt_type:
        - yes_no
      contains: "pattern to match"
    action:
      type: auto_reply
      value: "y"
`;

export default function PolicyPage() {
  const [showWizard, setShowWizard] = useState(false);
  const [editorMode, setEditorMode] = useState<"visual" | "yaml">("visual");
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [yamlContent, setYamlContent] = useState("");
  const [yamlError, setYamlError] = useState<string>();

  const { data: policyData, isLoading } = useQuery<PolicyData>({
    queryKey: ["/api/policy"],
    refetchInterval: false,
    staleTime: 10_000,
  });

  // Show wizard automatically if no policy is loaded
  const hasPolicy = !isLoading && policyData && policyData.rules.length > 0;

  // Initialize YAML content from server
  useEffect(() => {
    if (policyData?.raw && !yamlContent) {
      setYamlContent(policyData.raw);
    }
  }, [policyData?.raw, yamlContent]);

  const handleAddRule = () => {
    const currentYaml = yamlContent || policyData?.raw || "";
    const newYaml = currentYaml.trimEnd() + "\n" + NEW_RULE_TEMPLATE;
    setYamlContent(newYaml);
    setEditorMode("yaml");
  };

  const saveMutation = useMutation({
    mutationFn: async (yaml: string) => {
      const res = await apiRequest("PUT", "/api/policy", { yaml });
      return res.json();
    },
    onSuccess: () => {
      setYamlError(undefined);
      queryClient.invalidateQueries({ queryKey: ["/api/policy"] });
    },
    onError: (err) => {
      setYamlError(err instanceof Error ? err.message : "Validation failed");
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) => {
      await apiRequest("PATCH", `/api/policy/rules/${ruleId}/toggle`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policy"] });
    },
  });

  const rules = policyData?.rules || [];

  // Show wizard if no policy exists or user requested it
  if (!hasPolicy || showWizard) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
              <ScrollText className="w-5 h-5" />
              Policy Setup
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Set up rules for how AtlasBridge handles your AI tool's questions.
            </p>
          </div>
          {hasPolicy && (
            <Button variant="ghost" size="sm" onClick={() => setShowWizard(false)} className="gap-1.5">
              Back to rules
            </Button>
          )}
        </div>
        <PolicyWizard onDone={() => {
          setShowWizard(false);
          setYamlContent("");
        }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <ScrollText className="w-5 h-5" />
            Policy Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Rules for what AtlasBridge auto-handles and what needs your attention.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowWizard(true)} className="gap-1.5">
            <BookOpen className="w-3.5 h-3.5" />
            Setup Guide
          </Button>
          {policyData && (
            <Badge variant="outline" className="text-xs">
              {policyData.name} · {policyData.autonomy_mode}
            </Badge>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="presets">Presets</TabsTrigger>
          <TabsTrigger value="test">Test</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* Tab 1: Rules */}
        <TabsContent value="rules" className="space-y-4">
          {/* Mode toggle */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={editorMode === "visual" ? "default" : "outline"}
              onClick={() => setEditorMode("visual")}
              className="gap-1.5"
            >
              <Eye className="w-3.5 h-3.5" />
              Visual
            </Button>
            <Button
              size="sm"
              variant={editorMode === "yaml" ? "default" : "outline"}
              onClick={() => setEditorMode("yaml")}
              className="gap-1.5"
            >
              <FileCode className="w-3.5 h-3.5" />
              YAML
            </Button>
            <p className="text-[10px] text-muted-foreground ml-auto">Rules are checked top-to-bottom. First match wins.</p>
          </div>

          {editorMode === "visual" ? (
            <div className="space-y-3">
              {isLoading ? (
                <>
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16" />
                  ))}
                </>
              ) : rules.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="p-8 text-center">
                    <ScrollText className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      No rules yet. Use the setup guide or pick a preset above.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {rules.map((rule, i) => (
                    <RuleCard
                      key={rule.id}
                      rule={rule}
                      index={i}
                      isExpanded={expandedRule === rule.id}
                      onToggleExpand={() =>
                        setExpandedRule(expandedRule === rule.id ? null : rule.id)
                      }
                      onDelete={() => {
                        // TODO: implement delete
                      }}
                      onToggleEnabled={() => {
                        const currentlyEnabled = rule.enabled !== false;
                        toggleMutation.mutate({ ruleId: rule.id, enabled: !currentlyEnabled });
                      }}
                      enabled={rule.enabled !== false}
                    />
                  ))}
                  <Button variant="outline" className="gap-2 w-full" onClick={handleAddRule}>
                    <Plus className="w-4 h-4" />
                    Add Rule
                  </Button>
                </>
              )}
            </div>
          ) : (
            <YamlEditor
              yaml={yamlContent}
              onChange={setYamlContent}
              onSave={() => saveMutation.mutate(yamlContent)}
              saving={saveMutation.isPending}
              error={yamlError}
            />
          )}
        </TabsContent>

        {/* Tab 2: Presets */}
        <TabsContent value="presets">
          <PresetsPanel />
        </TabsContent>

        {/* Tab 3: Test */}
        <TabsContent value="test">
          <TestTab />
        </TabsContent>

        {/* Tab 3: Decision History */}
        <TabsContent value="history">
          <DecisionHistory />
        </TabsContent>
      </Tabs>
    </div>
  );
}
