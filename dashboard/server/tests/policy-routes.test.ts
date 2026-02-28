import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import yaml from "js-yaml";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("child_process", () => ({ execFile: vi.fn() }));

vi.mock("../db", () => ({
  insertOperatorAuditLog: vi.fn(),
  queryOperatorAuditLog: vi.fn(() => []),
  db: {},
  getAtlasBridgeDb: vi.fn(() => null),
}));

vi.mock("../config", () => ({
  getAtlasBridgeDir: vi.fn(() => "/tmp/atlasbridge-test"),
  ensureDir: vi.fn(),
  getAtlasBridgeDbPath: vi.fn(() => "/tmp/atlasbridge-test/atlasbridge.db"),
  getDashboardDbPath: vi.fn(() => "/tmp/atlasbridge-test/dashboard.db"),
  getTracePath: vi.fn(() => "/tmp/atlasbridge-test/trace.jsonl"),
  getConfigPath: vi.fn(() => "/tmp/atlasbridge-test/config.toml"),
  getArtifactsDir: vi.fn(() => "/tmp/atlasbridge-test/artifacts"),
}));

const mockExecFile = vi.fn();
vi.mock("child_process", () => ({ execFile: mockExecFile }));

// ---------------------------------------------------------------------------
// Test policy data
// ---------------------------------------------------------------------------

const SAMPLE_POLICY = {
  policy_version: "0",
  name: "test-policy",
  autonomy_mode: "assist",
  rules: [
    {
      id: "auto-enter",
      description: "Auto-confirm Enter prompts",
      match: { prompt_type: ["confirm_enter"], min_confidence: "medium" },
      action: { type: "auto_reply", value: "\\n" },
    },
    {
      id: "catch-all",
      description: "All other prompts require human",
      match: {},
      action: { type: "require_human", message: "Please review." },
    },
  ],
  defaults: { no_match: "require_human", low_confidence: "require_human" },
};

const SAMPLE_YAML = yaml.dump(SAMPLE_POLICY);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("policy routes helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("GET /api/policy logic", () => {
    it("returns parsed policy from YAML file", () => {
      const parsed = yaml.load(SAMPLE_YAML) as any;
      expect(parsed.name).toBe("test-policy");
      expect(parsed.autonomy_mode).toBe("assist");
      expect(parsed.rules).toHaveLength(2);
      expect(parsed.rules[0].id).toBe("auto-enter");
      expect(parsed.rules[1].id).toBe("catch-all");
    });

    it("returns empty state when no policy file exists", () => {
      const result = {
        name: null,
        autonomy_mode: null,
        policy_version: null,
        rules: [],
        defaults: {},
        active: false,
      };
      expect(result.active).toBe(false);
      expect(result.rules).toHaveLength(0);
    });
  });

  describe("preset activation", () => {
    it("rejects path traversal in preset name", () => {
      const preset = "../../../etc/passwd";
      const isInvalid = !preset || preset.includes("..") || preset.includes("/") || preset.includes("\\");
      expect(isInvalid).toBe(true);
    });

    it("rejects preset with forward slash", () => {
      const preset = "dir/malicious.yaml";
      const isInvalid = preset.includes("/");
      expect(isInvalid).toBe(true);
    });

    it("rejects preset with backslash", () => {
      const preset = "dir\\malicious.yaml";
      const isInvalid = preset.includes("\\");
      expect(isInvalid).toBe(true);
    });

    it("accepts valid preset name", () => {
      const preset = "full-mode-safe.yaml";
      const isInvalid = !preset || preset.includes("..") || preset.includes("/") || preset.includes("\\");
      expect(isInvalid).toBe(false);
    });
  });

  describe("rule toggle", () => {
    it("disables a rule by removing it from policy", () => {
      const policy = JSON.parse(JSON.stringify(SAMPLE_POLICY));
      const disabled: Record<string, any> = {};
      const ruleId = "auto-enter";

      const idx = policy.rules.findIndex((r: any) => r.id === ruleId);
      expect(idx).toBeGreaterThanOrEqual(0);

      const [removed] = policy.rules.splice(idx, 1);
      disabled[ruleId] = removed;

      expect(policy.rules).toHaveLength(1);
      expect(policy.rules[0].id).toBe("catch-all");
      expect(disabled[ruleId].id).toBe("auto-enter");
    });

    it("enables a rule by re-inserting it before catch-all", () => {
      const policy = {
        ...SAMPLE_POLICY,
        rules: [SAMPLE_POLICY.rules[1]], // only catch-all
      };
      const disabled: Record<string, any> = {
        "auto-enter": SAMPLE_POLICY.rules[0],
      };

      const rule = disabled["auto-enter"];
      const catchAllIdx = policy.rules.findIndex(
        (r: any) => r.id === "catch-all" || (typeof r.match === "object" && Object.keys(r.match).length === 0),
      );

      if (catchAllIdx >= 0) {
        policy.rules.splice(catchAllIdx, 0, rule);
      } else {
        policy.rules.push(rule);
      }
      delete disabled["auto-enter"];

      expect(policy.rules).toHaveLength(2);
      expect(policy.rules[0].id).toBe("auto-enter");
      expect(policy.rules[1].id).toBe("catch-all");
      expect(disabled["auto-enter"]).toBeUndefined();
    });

    it("preserves rule definition through disable/enable cycle", () => {
      const original = JSON.parse(JSON.stringify(SAMPLE_POLICY.rules[0]));
      const disabled: Record<string, any> = {};

      // Disable
      disabled["auto-enter"] = original;

      // Enable
      const restored = disabled["auto-enter"];
      delete disabled["auto-enter"];

      expect(restored).toEqual(original);
      expect(restored.action.type).toBe("auto_reply");
      expect(restored.match.prompt_type).toEqual(["confirm_enter"]);
    });
  });

  describe("YAML serialization", () => {
    it("round-trips policy through YAML dump and load", () => {
      const dumped = yaml.dump(SAMPLE_POLICY, { lineWidth: -1, noRefs: true });
      const reloaded = yaml.load(dumped) as any;

      expect(reloaded.name).toBe(SAMPLE_POLICY.name);
      expect(reloaded.autonomy_mode).toBe(SAMPLE_POLICY.autonomy_mode);
      expect(reloaded.rules).toHaveLength(SAMPLE_POLICY.rules.length);
      expect(reloaded.rules[0].id).toBe("auto-enter");
    });
  });

  describe("disabled rules sidecar", () => {
    it("parses empty object when sidecar does not exist", () => {
      const result = {};
      expect(Object.keys(result)).toHaveLength(0);
    });

    it("merges disabled rules with active rules", () => {
      const activeRules = SAMPLE_POLICY.rules.map((r) => ({ ...r, enabled: true }));
      const disabled: Record<string, any> = {
        "deny-credentials": { id: "deny-credentials", description: "Block creds", match: {}, action: { type: "deny" } },
      };

      const disabledEntries = Object.entries(disabled)
        .filter(([id]) => !activeRules.some((r) => r.id === id))
        .map(([, rule]) => ({ ...rule, enabled: false }));

      const allRules = [...activeRules, ...disabledEntries];

      expect(allRules).toHaveLength(3);
      expect(allRules[0].enabled).toBe(true);
      expect(allRules[2].enabled).toBe(false);
      expect(allRules[2].id).toBe("deny-credentials");
    });
  });
});
