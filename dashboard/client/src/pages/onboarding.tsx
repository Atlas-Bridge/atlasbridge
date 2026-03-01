import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ShieldCheck, MonitorDot, Globe, Code, Sparkles, ArrowRight,
  ArrowLeft, Check, ChevronRight, Eye, Zap, Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DetectedTool {
  id: string;
  name: string;
  type: "vscode" | "desktop" | "browser";
  detected: boolean;
  description: string;
}

interface SetupStatus {
  configured: boolean;
  hasPolicy: boolean;
  configPath: string;
}

interface DetectResult {
  tools: DetectedTool[];
  platform: string;
}

const STEPS = [
  { label: "Welcome", id: "welcome" },
  { label: "AI Tools", id: "tools" },
  { label: "Autonomy", id: "autonomy" },
  { label: "Monitors", id: "monitors" },
  { label: "Ready", id: "ready" },
] as const;

const AUTONOMY_MODES = [
  {
    id: "off" as const,
    label: "Off",
    icon: Eye,
    description: "All prompts forwarded to you. No automatic decisions.",
    detail: "When your AI tool asks a question, it appears in the dashboard. You review and respond to every single prompt manually.",
    color: "border-blue-500/30 bg-blue-500/5",
    activeColor: "border-blue-500 bg-blue-500/10",
    badge: "Most control",
  },
  {
    id: "assist" as const,
    label: "Assist",
    icon: Zap,
    description: "Policy handles explicitly allowed prompts. All others escalated to you.",
    detail: "Simple, known prompts (like 'Continue? [y/n]') are auto-handled based on your policy rules. Anything unknown or risky gets sent to you.",
    color: "border-amber-500/30 bg-amber-500/5",
    activeColor: "border-amber-500 bg-amber-500/10",
    badge: "Recommended",
  },
  {
    id: "full" as const,
    label: "Full",
    icon: Bot,
    description: "Policy auto-executes permitted prompts. Only no-match or low-confidence escalated.",
    detail: "Your AI tools run with maximum autonomy. Only truly ambiguous or unrecognised prompts are escalated. Best when you have a well-tuned policy.",
    color: "border-emerald-500/30 bg-emerald-500/5",
    activeColor: "border-emerald-500 bg-emerald-500/10",
    badge: "Most autonomy",
  },
];

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {STEPS.map((step, i) => (
        <div key={step.id} className="flex items-center gap-2">
          <div
            className={cn(
              "flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-all",
              i < currentStep
                ? "bg-primary text-primary-foreground"
                : i === currentStep
                  ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {i < currentStep ? <Check className="w-4 h-4" /> : i + 1}
          </div>
          <span
            className={cn(
              "text-xs hidden sm:inline",
              i <= currentStep ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {step.label}
          </span>
          {i < STEPS.length - 1 && (
            <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
          )}
        </div>
      ))}
    </div>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center max-w-lg mx-auto space-y-6">
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <ShieldCheck className="w-8 h-8 text-primary" />
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome to AtlasBridge
        </h1>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          AtlasBridge watches your AI tools and helps you manage what they do.
          Set rules for what should be auto-approved, and get notified when
          something needs your attention.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
        <Card className="border-dashed">
          <CardContent className="p-4 space-y-2">
            <MonitorDot className="w-5 h-5 text-blue-500" />
            <p className="text-sm font-medium">Monitor</p>
            <p className="text-xs text-muted-foreground">
              See what your AI tools are doing in real-time
            </p>
          </CardContent>
        </Card>
        <Card className="border-dashed">
          <CardContent className="p-4 space-y-2">
            <ShieldCheck className="w-5 h-5 text-amber-500" />
            <p className="text-sm font-medium">Control</p>
            <p className="text-xs text-muted-foreground">
              Set policies for what gets auto-approved
            </p>
          </CardContent>
        </Card>
        <Card className="border-dashed">
          <CardContent className="p-4 space-y-2">
            <Sparkles className="w-5 h-5 text-emerald-500" />
            <p className="text-sm font-medium">Automate</p>
            <p className="text-xs text-muted-foreground">
              Let safe actions happen without your input
            </p>
          </CardContent>
        </Card>
      </div>

      <Button onClick={onNext} size="lg" className="gap-2">
        Get started <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  );
}

function ToolsStep({
  tools,
  selectedTools,
  onToggle,
  onNext,
  onBack,
}: {
  tools: DetectedTool[];
  selectedTools: string[];
  onToggle: (id: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const typeIcon = (type: string) => {
    switch (type) {
      case "vscode": return Code;
      case "desktop": return MonitorDot;
      case "browser": return Globe;
      default: return MonitorDot;
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold tracking-tight">
          What AI tools do you use?
        </h2>
        <p className="text-sm text-muted-foreground mt-2">
          Select the tools you want AtlasBridge to monitor. You can change this later in Settings.
        </p>
      </div>

      <div className="space-y-2">
        {tools.map((tool) => {
          const Icon = typeIcon(tool.type);
          const selected = selectedTools.includes(tool.id);
          return (
            <button
              key={tool.id}
              onClick={() => onToggle(tool.id)}
              className={cn(
                "w-full flex items-center gap-4 p-4 rounded-lg border transition-all text-left",
                selected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/30",
              )}
            >
              <div
                className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                  selected ? "bg-primary/10" : "bg-muted",
                )}
              >
                <Icon
                  className={cn(
                    "w-5 h-5",
                    selected ? "text-primary" : "text-muted-foreground",
                  )}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{tool.name}</span>
                  {tool.detected && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      Detected
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {tool.description}
                </p>
              </div>
              <div
                className={cn(
                  "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0",
                  selected
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/30",
                )}
              >
                {selected && <Check className="w-3 h-3 text-primary-foreground" />}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Button onClick={onNext} className="gap-2">
          Continue <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function AutonomyStep({
  mode,
  onSelect,
  onNext,
  onBack,
}: {
  mode: "off" | "assist" | "full";
  onSelect: (m: "off" | "assist" | "full") => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold tracking-tight">
          Choose autonomy mode
        </h2>
        <p className="text-sm text-muted-foreground mt-2">
          How much should AtlasBridge handle on its own? You can change this anytime.
        </p>
      </div>

      <div className="space-y-3">
        {AUTONOMY_MODES.map((opt) => {
          const selected = mode === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => onSelect(opt.id)}
              className={cn(
                "w-full p-4 rounded-lg border-2 transition-all text-left",
                selected ? opt.activeColor : opt.color,
              )}
            >
              <div className="flex items-center gap-3">
                <opt.icon
                  className={cn("w-5 h-5 shrink-0", selected ? "text-foreground" : "text-muted-foreground")}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{opt.label}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {opt.badge}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{opt.description}</p>
                </div>
                <div
                  className={cn(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0",
                    selected ? "border-primary bg-primary" : "border-muted-foreground/30",
                  )}
                >
                  {selected && <Check className="w-3 h-3 text-primary-foreground" />}
                </div>
              </div>
              {selected && (
                <p className="text-xs text-muted-foreground mt-3 pl-8">{opt.detail}</p>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Button onClick={onNext} className="gap-2">
          Continue <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function MonitorsStep({
  selectedTools,
  enabledMonitors,
  onToggleMonitor,
  onNext,
  onBack,
}: {
  selectedTools: string[];
  enabledMonitors: string[];
  onToggleMonitor: (m: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const needsVSCode = selectedTools.some((t) => t.includes("vscode"));
  const needsDesktop = selectedTools.some(
    (t) => t.includes("desktop"),
  );
  const needsBrowser = selectedTools.some((t) => t.includes("web") || t.includes("browser"));

  // Poll accessibility permission status when desktop monitor is enabled
  const desktopEnabled = enabledMonitors.includes("desktop");
  const { data: accessData } = useQuery<{ granted: boolean; platform: string; reason?: string }>({
    queryKey: ["/api/setup/accessibility"],
    refetchInterval: desktopEnabled ? 2000 : false,
    enabled: needsDesktop,
  });

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold tracking-tight">
          Enable monitors
        </h2>
        <p className="text-sm text-muted-foreground mt-2">
          Monitors watch your AI tools and feed activity into the dashboard.
        </p>
      </div>

      <div className="space-y-3">
        {needsVSCode && (
          <Card
            className={cn(
              "cursor-pointer transition-all",
              enabledMonitors.includes("vscode")
                ? "border-primary bg-primary/5"
                : "",
            )}
            onClick={() => onToggleMonitor("vscode")}
          >
            <CardContent className="p-4 flex items-center gap-4">
              <Code className="w-5 h-5 text-blue-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">VS Code Monitor</p>
                <p className="text-xs text-muted-foreground">
                  Auto-detects Claude Code sessions in VS Code via lock files
                </p>
              </div>
              <div
                className={cn(
                  "w-5 h-5 rounded border-2 flex items-center justify-center",
                  enabledMonitors.includes("vscode")
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/30",
                )}
              >
                {enabledMonitors.includes("vscode") && (
                  <Check className="w-3 h-3 text-primary-foreground" />
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {needsDesktop && (
          <Card
            className={cn(
              "cursor-pointer transition-all",
              desktopEnabled
                ? "border-primary bg-primary/5"
                : "",
            )}
            onClick={() => onToggleMonitor("desktop")}
          >
            <CardContent className="p-4 flex items-center gap-4">
              <MonitorDot className="w-5 h-5 text-amber-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Desktop Monitor</p>
                <p className="text-xs text-muted-foreground">
                  Reads conversations from Claude Desktop and ChatGPT desktop apps
                </p>

                {desktopEnabled && accessData && !accessData.granted && accessData.platform === "darwin" && (
                  <div className="mt-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                      <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                        Waiting for Accessibility permission...
                      </p>
                    </div>
                    <p className="text-[10px] text-amber-600 dark:text-amber-400">
                      macOS requires you to allow access once. Click below to open the settings — find and toggle on your terminal app (Terminal, iTerm, or VS Code).
                    </p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility", "_blank");
                      }}
                      className="inline-flex items-center gap-1.5 mt-1 px-3 py-1.5 rounded-md bg-amber-600 text-white text-[11px] font-medium hover:bg-amber-700 transition-colors"
                    >
                      Open Accessibility Settings
                    </button>
                  </div>
                )}

                {desktopEnabled && accessData?.granted && (
                  <div className="mt-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
                      Accessibility permission granted
                    </p>
                  </div>
                )}
              </div>
              <div
                className={cn(
                  "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0",
                  desktopEnabled
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/30",
                )}
              >
                {desktopEnabled && (
                  <Check className="w-3 h-3 text-primary-foreground" />
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {needsBrowser && (
          <Card className="border-dashed border-purple-500/20">
            <CardContent className="p-4 flex items-center gap-4">
              <Globe className="w-5 h-5 text-purple-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Browser Extension</p>
                <p className="text-xs text-muted-foreground">
                  Monitors ChatGPT, Claude.ai, and Gemini conversations in your browser.
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  To install: Open Chrome &rarr; <code className="bg-muted px-1 rounded">chrome://extensions</code> &rarr;
                  Enable "Developer mode" &rarr; "Load unpacked" &rarr; select the <code className="bg-muted px-1 rounded">extension/dist/</code> folder from the AtlasBridge repo.
                </p>
              </div>
              <Badge variant="secondary" className="text-[10px]">Chrome</Badge>
            </CardContent>
          </Card>
        )}

        {!needsVSCode && !needsDesktop && !needsBrowser && (
          <Card className="border-dashed">
            <CardContent className="p-4 text-center text-sm text-muted-foreground">
              No monitors needed based on your tool selections. You can enable them later in Settings.
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Button onClick={onNext} className="gap-2">
          Finish setup <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function ReadyStep({ saving, onGoToDashboard, onTakeTour }: {
  saving: boolean;
  onGoToDashboard: () => void;
  onTakeTour: () => void;
}) {
  return (
    <div className="text-center max-w-lg mx-auto space-y-6">
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
          <Check className="w-8 h-8 text-emerald-500" />
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          You're all set!
        </h2>
        <p className="text-muted-foreground mt-2">
          AtlasBridge is configured and ready to go. You can adjust any of these
          settings later from the Settings page.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row justify-center gap-3">
        <Button onClick={onGoToDashboard} size="lg" className="gap-2" disabled={saving}>
          Open Dashboard <ArrowRight className="w-4 h-4" />
        </Button>
        <Button
          onClick={onTakeTour}
          size="lg"
          variant="outline"
          className="gap-2"
          disabled={saving}
        >
          Take the tour <Sparkles className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [autonomyMode, setAutonomyMode] = useState<"off" | "assist" | "full">("assist");
  const [enabledMonitors, setEnabledMonitors] = useState<string[]>(["vscode"]);

  const { data: detectData } = useQuery<DetectResult>({
    queryKey: ["/api/setup/detect"],
    refetchInterval: false,
    staleTime: 60_000,
  });

  const initMutation = useMutation({
    mutationFn: (data: { autonomyMode: string; selectedTools: string[]; enabledMonitors: string[] }) =>
      apiRequest("POST", "/api/setup/init", data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/setup/status"] });
      // Auto-start enabled monitors after saving config
      for (const monitor of variables.enabledMonitors) {
        apiRequest("POST", `/api/monitor/daemons/${monitor}/start`).catch(() => {
          // Best-effort — monitor start failures don't block onboarding
        });
      }
    },
  });

  // Auto-select detected tools
  const tools = detectData?.tools || [];
  if (tools.length > 0 && selectedTools.length === 0) {
    const detected = tools.filter((t) => t.detected).map((t) => t.id);
    if (detected.length > 0) {
      setSelectedTools(detected);
    }
  }

  const toggleTool = (id: string) => {
    setSelectedTools((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  };

  const toggleMonitor = (m: string) => {
    setEnabledMonitors((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    );
  };

  const handleFinish = () => {
    setStep(4);
    initMutation.mutate({ autonomyMode, selectedTools, enabledMonitors });
  };

  const handleGoToDashboard = () => {
    navigate("/");
  };

  const handleTakeTour = () => {
    // Store tutorial trigger in localStorage, then navigate
    localStorage.setItem("atlasbridge_start_tutorial", "true");
    navigate("/");
  };

  return (
    <div className="min-h-[60vh] flex flex-col justify-center py-8">
      <StepIndicator currentStep={step} />

      {step === 0 && <WelcomeStep onNext={() => setStep(1)} />}
      {step === 1 && (
        <ToolsStep
          tools={tools}
          selectedTools={selectedTools}
          onToggle={toggleTool}
          onNext={() => setStep(2)}
          onBack={() => setStep(0)}
        />
      )}
      {step === 2 && (
        <AutonomyStep
          mode={autonomyMode}
          onSelect={setAutonomyMode}
          onNext={() => setStep(3)}
          onBack={() => setStep(1)}
        />
      )}
      {step === 3 && (
        <MonitorsStep
          selectedTools={selectedTools}
          enabledMonitors={enabledMonitors}
          onToggleMonitor={toggleMonitor}
          onNext={handleFinish}
          onBack={() => setStep(2)}
        />
      )}
      {step === 4 && (
        <ReadyStep
          saving={initMutation.isPending}
          onGoToDashboard={handleGoToDashboard}
          onTakeTour={handleTakeTour}
        />
      )}
    </div>
  );
}
