import type { Express } from "express";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { requireCsrf } from "../middleware/csrf";
import { operatorRateLimiter } from "../middleware/rate-limit";
import { insertOperatorAuditLog } from "../db";
import { getAtlasBridgeDir, ensureDir } from "../config";
import { runAtlasBridge } from "./operator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPolicyPath(): string {
  return path.join(getAtlasBridgeDir(), "policy.yaml");
}

function getDisabledRulesPath(): string {
  return path.join(getAtlasBridgeDir(), "disabled_rules.json");
}

function getPresetsDir(): string {
  // Walk up from CWD to find config/policies/
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, "config", "policies");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), "config", "policies");
}

interface PolicyRule {
  id: string;
  description?: string;
  match?: Record<string, unknown>;
  action?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ParsedPolicy {
  policy_version?: string;
  name?: string;
  autonomy_mode?: string;
  rules?: PolicyRule[];
  defaults?: Record<string, unknown>;
}

function readPolicy(): { raw: string; parsed: ParsedPolicy } | null {
  const p = getPolicyPath();
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf-8");
  // Use json: true to silently accept duplicate keys (last value wins)
  const parsed = yaml.load(raw, { json: true }) as ParsedPolicy;
  return { raw, parsed };
}

function readDisabledRules(): Record<string, PolicyRule> {
  const p = getDisabledRulesPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function writeDisabledRules(rules: Record<string, PolicyRule>): void {
  ensureDir(getAtlasBridgeDir());
  fs.writeFileSync(getDisabledRulesPath(), JSON.stringify(rules, null, 2));
}

function writePolicy(yamlContent: string): void {
  ensureDir(getAtlasBridgeDir());
  const p = getPolicyPath();
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, yamlContent);
  fs.renameSync(tmp, p);
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerPolicyRoutes(app: Express): void {
  // ---------------------------------------------------------------------------
  // GET /api/policy — return the active policy parsed from YAML
  // ---------------------------------------------------------------------------
  app.get("/api/policy", (_req, res) => {
    try {
      const result = readPolicy();
      if (!result) {
        res.json({
          name: null,
          autonomy_mode: null,
          policy_version: null,
          rules: [],
          defaults: {},
          active: false,
        });
        return;
      }

      const { parsed } = result;
      const disabled = readDisabledRules();

      // Merge active rules with disabled rules to show full picture
      const activeRules = (parsed.rules ?? []).map((r) => ({
        ...r,
        enabled: true,
      }));

      // Add disabled rules that aren't in the active policy
      const disabledEntries = Object.entries(disabled)
        .filter(([id]) => !activeRules.some((r) => r.id === id))
        .map(([, rule]) => ({ ...rule, enabled: false }));

      res.json({
        name: parsed.name ?? "unknown",
        autonomy_mode: parsed.autonomy_mode ?? "off",
        policy_version: parsed.policy_version ?? "0",
        rules: [...activeRules, ...disabledEntries],
        defaults: parsed.defaults ?? {},
        active: true,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to read policy", detail: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/policy/presets — list available preset policies
  // ---------------------------------------------------------------------------
  app.get("/api/policy/presets", (_req, res) => {
    try {
      const presetsDir = getPresetsDir();
      if (!fs.existsSync(presetsDir)) {
        res.json([]);
        return;
      }

      const files = fs.readdirSync(presetsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
      const presets = files.map((file) => {
        try {
          const raw = fs.readFileSync(path.join(presetsDir, file), "utf-8");
          const parsed = yaml.load(raw) as ParsedPolicy;
          return {
            file,
            name: parsed.name ?? file.replace(/\.ya?ml$/, ""),
            autonomy_mode: parsed.autonomy_mode ?? "off",
            policy_version: parsed.policy_version ?? "0",
            rule_count: (parsed.rules ?? []).length,
          };
        } catch {
          return { file, name: file, autonomy_mode: "unknown", policy_version: "0", rule_count: 0 };
        }
      });

      res.json(presets);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to list presets", detail: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/policy/activate — activate a preset policy
  // ---------------------------------------------------------------------------
  app.post(
    "/api/policy/activate",
    requireCsrf,
    operatorRateLimiter,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const preset = typeof body.preset === "string" ? body.preset : "";

      // Path traversal guard
      if (!preset || preset.includes("..") || preset.includes("/") || preset.includes("\\")) {
        res.status(400).json({ error: "Invalid preset name" });
        return;
      }

      const presetsDir = getPresetsDir();
      const presetPath = path.join(presetsDir, preset);

      if (!fs.existsSync(presetPath)) {
        res.status(404).json({ error: `Preset not found: ${preset}` });
        return;
      }

      try {
        // Validate via CLI
        try {
          await runAtlasBridge(["policy", "validate", presetPath]);
        } catch (err: any) {
          res.status(422).json({
            error: "Policy validation failed",
            detail: (err.stderr as string | undefined)?.trim() ?? err.message,
          });
          return;
        }

        // Read preset content and write to active policy
        const content = fs.readFileSync(presetPath, "utf-8");
        writePolicy(content);

        // Clear disabled rules sidecar since we're switching to a new policy
        writeDisabledRules({});

        insertOperatorAuditLog({
          method: "POST",
          path: "/api/policy/activate",
          action: `policy-activate:${preset}`,
          body: { preset },
          result: "ok",
        });

        res.json({ ok: true, preset, message: `Policy "${preset}" activated` });
      } catch (err: any) {
        insertOperatorAuditLog({
          method: "POST",
          path: "/api/policy/activate",
          action: `policy-activate:${preset}`,
          body: { preset },
          result: "error",
          error: err.message,
        });
        res.status(500).json({ error: "Failed to activate policy", detail: err.message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // PUT /api/policy — write raw YAML as the active policy
  // ---------------------------------------------------------------------------
  app.put(
    "/api/policy",
    requireCsrf,
    operatorRateLimiter,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const yamlContent = typeof body.yaml === "string" ? body.yaml : "";

      if (!yamlContent.trim()) {
        res.status(400).json({ error: "Empty policy YAML" });
        return;
      }

      try {
        // Parse to validate YAML syntax
        yaml.load(yamlContent);
      } catch (err: any) {
        res.status(422).json({ error: "Invalid YAML syntax", detail: err.message });
        return;
      }

      try {
        // Write to temp file and validate via CLI
        const tmpPath = getPolicyPath() + ".pending";
        ensureDir(getAtlasBridgeDir());
        fs.writeFileSync(tmpPath, yamlContent);

        try {
          await runAtlasBridge(["policy", "validate", tmpPath]);
        } catch (err: any) {
          fs.unlinkSync(tmpPath);
          res.status(422).json({
            error: "Policy validation failed",
            detail: (err.stderr as string | undefined)?.trim() ?? err.message,
          });
          return;
        }

        // Validation passed — atomic rename
        fs.renameSync(tmpPath, getPolicyPath());

        insertOperatorAuditLog({
          method: "PUT",
          path: "/api/policy",
          action: "policy-update",
          body: { size: yamlContent.length },
          result: "ok",
        });

        res.json({ ok: true, message: "Policy updated" });
      } catch (err: any) {
        insertOperatorAuditLog({
          method: "PUT",
          path: "/api/policy",
          action: "policy-update",
          body: { size: yamlContent.length },
          result: "error",
          error: err.message,
        });
        res.status(500).json({ error: "Failed to update policy", detail: err.message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/policy/rules/:ruleId/toggle — enable/disable a rule
  // ---------------------------------------------------------------------------
  app.patch(
    "/api/policy/rules/:ruleId/toggle",
    requireCsrf,
    operatorRateLimiter,
    async (req, res) => {
      const ruleId = typeof req.params.ruleId === "string" ? req.params.ruleId : String(req.params.ruleId);
      const body = req.body as Record<string, unknown>;
      const enabled = body.enabled === true;

      try {
        const result = readPolicy();
        if (!result) {
          res.status(404).json({ error: "No active policy" });
          return;
        }

        const { parsed } = result;
        const disabled = readDisabledRules();

        if (enabled) {
          // Re-enable: move rule from sidecar back into policy
          const rule = disabled[ruleId];
          if (!rule) {
            res.status(404).json({ error: `Rule "${ruleId}" not found in disabled rules` });
            return;
          }

          // Find insertion point — try to insert before the catch-all
          const rules = parsed.rules ?? [];
          const catchAllIdx = rules.findIndex(
            (r) => r.id === "catch-all" || r.match === undefined || (typeof r.match === "object" && Object.keys(r.match as object).length === 0),
          );

          if (catchAllIdx >= 0) {
            rules.splice(catchAllIdx, 0, rule);
          } else {
            rules.push(rule);
          }
          parsed.rules = rules;

          // Remove from sidecar
          delete disabled[ruleId];
          writeDisabledRules(disabled);
        } else {
          // Disable: remove rule from policy and save to sidecar
          const rules = parsed.rules ?? [];
          const idx = rules.findIndex((r) => r.id === ruleId);
          if (idx < 0) {
            res.status(404).json({ error: `Rule "${ruleId}" not found in active policy` });
            return;
          }

          const [removed] = rules.splice(idx, 1);
          parsed.rules = rules;

          // Save to sidecar
          disabled[ruleId] = removed;
          writeDisabledRules(disabled);
        }

        // Re-serialize and write
        const newYaml = yaml.dump(parsed, {
          lineWidth: -1,
          noRefs: true,
          quotingType: '"',
          forceQuotes: false,
        });
        writePolicy(newYaml);

        insertOperatorAuditLog({
          method: "PATCH",
          path: `/api/policy/rules/${ruleId}/toggle`,
          action: `rule-${enabled ? "enable" : "disable"}:${ruleId}`,
          body: { ruleId, enabled },
          result: "ok",
        });

        res.json({ ok: true, ruleId, enabled });
      } catch (err: any) {
        insertOperatorAuditLog({
          method: "PATCH",
          path: `/api/policy/rules/${ruleId}/toggle`,
          action: `rule-toggle:${ruleId}`,
          body: { ruleId, enabled },
          result: "error",
          error: err.message,
        });
        res.status(500).json({ error: "Failed to toggle rule", detail: err.message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/policy/test — test a prompt against the active policy
  // ---------------------------------------------------------------------------
  app.post(
    "/api/policy/test",
    requireCsrf,
    operatorRateLimiter,
    async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      const promptType = typeof body.type === "string" ? body.type : "yes_no";
      const confidence = typeof body.confidence === "string" ? body.confidence : "high";

      if (!prompt) {
        res.status(400).json({ error: "prompt is required" });
        return;
      }

      const validTypes = ["yes_no", "confirm_enter", "multiple_choice", "free_text"];
      const validConfidence = ["high", "medium", "low"];
      if (!validTypes.includes(promptType)) {
        res.status(400).json({ error: `Invalid type. Must be: ${validTypes.join(", ")}` });
        return;
      }
      if (!validConfidence.includes(confidence)) {
        res.status(400).json({ error: `Invalid confidence. Must be: ${validConfidence.join(", ")}` });
        return;
      }

      const policyPath = getPolicyPath();
      if (!fs.existsSync(policyPath)) {
        res.status(404).json({ error: "No active policy file" });
        return;
      }

      try {
        const { stdout } = await runAtlasBridge([
          "policy", "test", policyPath,
          "--prompt", prompt,
          "--type", promptType,
          "--confidence", confidence,
        ]);

        // Parse the CLI output for key fields
        const lines = stdout.trim().split("\n");
        let actionType = "unknown";
        let actionValue = "";
        let matchedRule = "";
        let explanation = "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("Decision:")) actionType = trimmed.replace("Decision:", "").trim().toLowerCase();
          if (trimmed.startsWith("Reply value:")) actionValue = trimmed.replace("Reply value:", "").trim().replace(/^'|'$/g, "");
          if (trimmed.startsWith("Matched rule:")) matchedRule = trimmed.replace("Matched rule:", "").trim();
          if (trimmed.startsWith("Explanation:")) explanation = trimmed.replace("Explanation:", "").trim();
        }

        // Generate plain-English summary
        let summary = "";
        switch (actionType) {
          case "auto_reply":
            summary = actionValue
              ? `This prompt would be auto-replied with "${actionValue === "\\n" ? "Enter" : actionValue}".`
              : "This prompt would be auto-replied.";
            break;
          case "require_human":
            summary = "This prompt would be sent to your phone/Slack for you to answer.";
            break;
          case "deny":
            summary = "This prompt would be blocked. No response sent.";
            break;
          case "notify_only":
            summary = "This prompt would be logged and you'd be notified, but no action taken.";
            break;
          default:
            summary = "No matching rule found. The default action would apply.";
        }

        res.json({
          action_type: actionType,
          action_value: actionValue || null,
          matched_rule: matchedRule || null,
          explanation: explanation || null,
          summary,
        });
      } catch (err: any) {
        const detail = (err.stderr as string | undefined)?.trim() ?? err.message;
        res.status(500).json({ error: "Policy test failed", detail });
      }
    },
  );
}
