import { Router } from "express";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { getAtlasBridgeDir, getConfigPath, ensureDir } from "../config";
import { stringify as stringifyTOML } from "smol-toml";
import { requireCsrf } from "../middleware/csrf";

const router = Router();

/**
 * GET /api/setup/status
 * Check if AtlasBridge has been configured (config file exists).
 */
router.get("/api/setup/status", (_req, res) => {
  const configPath = getConfigPath();
  const configured = fs.existsSync(configPath);

  // Also check if there's a policy file
  const policyPath = path.join(getAtlasBridgeDir(), "policy.yaml");
  const hasPolicy = fs.existsSync(policyPath);

  res.json({
    configured,
    hasPolicy,
    configPath,
  });
});

/**
 * GET /api/setup/detect
 * Auto-detect which AI tools are available on the system.
 */
router.get("/api/setup/detect", (_req, res) => {
  const tools: Array<{
    id: string;
    name: string;
    type: "vscode" | "desktop" | "browser";
    detected: boolean;
    description: string;
  }> = [];

  // Check for Claude Code in VS Code (lock files)
  const claudeLockDir = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".claude",
    "ide",
  );
  const hasClaudeLocks =
    fs.existsSync(claudeLockDir) &&
    fs.readdirSync(claudeLockDir).some((f) => f.endsWith(".lock"));

  tools.push({
    id: "claude-code-vscode",
    name: "Claude Code (VS Code)",
    type: "vscode",
    detected: hasClaudeLocks,
    description:
      "Monitor Claude Code sessions running in Visual Studio Code",
  });

  // Check for Claude Desktop (macOS)
  if (process.platform === "darwin") {
    const claudeDesktop = fs.existsSync(
      "/Applications/Claude.app",
    );
    tools.push({
      id: "claude-desktop",
      name: "Claude Desktop",
      type: "desktop",
      detected: claudeDesktop,
      description:
        "Monitor conversations in the Claude desktop app",
    });

    // Check for ChatGPT desktop (macOS)
    const chatgptDesktop = fs.existsSync(
      "/Applications/ChatGPT.app",
    );
    tools.push({
      id: "chatgpt-desktop",
      name: "ChatGPT Desktop",
      type: "desktop",
      detected: chatgptDesktop,
      description:
        "Monitor conversations in the ChatGPT desktop app",
    });
  }

  // Browser-based tools (always available, need extension)
  tools.push({
    id: "claude-web",
    name: "Claude.ai (Browser)",
    type: "browser",
    detected: false,
    description:
      "Monitor Claude.ai conversations via browser extension",
  });

  tools.push({
    id: "chatgpt-web",
    name: "ChatGPT (Browser)",
    type: "browser",
    detected: false,
    description:
      "Monitor ChatGPT conversations via browser extension",
  });

  tools.push({
    id: "gemini-web",
    name: "Google Gemini (Browser)",
    type: "browser",
    detected: false,
    description:
      "Monitor Gemini conversations via browser extension",
  });

  res.json({ tools, platform: process.platform });
});

/**
 * POST /api/setup/init
 * Write initial configuration from onboarding wizard choices.
 */
router.post("/api/setup/init", requireCsrf, (req, res) => {
  const { autonomyMode, selectedTools, enabledMonitors } = req.body;

  if (!autonomyMode || !["off", "assist", "full"].includes(autonomyMode)) {
    res.status(400).json({ error: "Invalid autonomy mode" });
    return;
  }

  const configDir = getAtlasBridgeDir();
  ensureDir(configDir);

  // Build config TOML
  const config: Record<string, unknown> = {
    version: 1,
    autonomy_mode: autonomyMode,
    dashboard: {
      port: 3737,
      host: "127.0.0.1",
    },
    monitors: {
      vscode: enabledMonitors?.includes("vscode") ?? false,
      desktop: enabledMonitors?.includes("desktop") ?? false,
    },
    onboarding: {
      completed: true,
      completed_at: new Date().toISOString(),
      selected_tools: selectedTools || [],
    },
  };

  const configPath = getConfigPath();
  const tomlContent = stringifyTOML(config);

  // Write config (atomic: temp + rename)
  const tmpPath = configPath + ".tmp";
  fs.writeFileSync(tmpPath, tomlContent, "utf-8");
  fs.renameSync(tmpPath, configPath);

  // Copy a default policy if none exists
  const policyPath = path.join(configDir, "policy.yaml");
  if (!fs.existsSync(policyPath)) {
    // Try to copy the minimal preset
    const presetsDir = path.resolve(__dirname, "..", "..", "..", "config", "policies");
    const minimalPreset = path.join(presetsDir, "minimal.yaml");
    if (fs.existsSync(minimalPreset)) {
      fs.copyFileSync(minimalPreset, policyPath);
    }
  }

  res.json({ ok: true, configPath });
});

/**
 * GET /api/setup/accessibility
 * Check macOS Accessibility permission status (needed for desktop monitor).
 * Returns { granted: boolean, platform: string }.
 */
router.get("/api/setup/accessibility", (_req, res) => {
  if (process.platform !== "darwin") {
    res.json({ granted: true, platform: process.platform, reason: "not_macos" });
    return;
  }

  // Use Python to check AXIsProcessTrusted
  const { execSync } = require("child_process");
  const parentDir = path.dirname(process.cwd());
  const candidates = [
    path.join(parentDir, ".venv", "bin", "python"),
    path.join(parentDir, "venv", "bin", "python"),
    path.join(process.cwd(), ".venv", "bin", "python"),
    "python3",
  ];

  let py = "python3";
  for (const c of candidates) {
    if (fs.existsSync(c)) { py = c; break; }
  }

  try {
    const result = execSync(
      `${py} -c "from ApplicationServices import AXIsProcessTrusted; print(AXIsProcessTrusted())"`,
      { encoding: "utf-8", timeout: 5000, stdio: "pipe" },
    ).trim();
    res.json({ granted: result === "True", platform: "darwin" });
  } catch {
    // If Python/pyobjc not available, assume not checkable
    res.json({ granted: false, platform: "darwin", reason: "check_failed" });
  }
});

export function registerSetupRoutes(app: Router): void {
  app.use(router);
}
