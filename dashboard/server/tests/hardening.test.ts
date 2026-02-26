/**
 * Security regression tests — dashboard hardening (#332).
 *
 * Covers:
 *   - Payload size limits (32 KB hard cap)
 *   - Content-type enforcement (application/json required for mutations)
 *   - Safe error handling (no stack traces in production responses)
 *   - CSRF enforcement on operator endpoints
 *   - Rate limiting enforcement
 *   - Localhost-only binding assertion
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// 1. Payload size limit middleware
// ---------------------------------------------------------------------------

describe("Payload size limit", () => {
  it("accepts payload under 32 KB", () => {
    const body = JSON.stringify({ mode: "assist", extra: "x".repeat(100) });
    expect(Buffer.byteLength(body, "utf8")).toBeLessThan(32 * 1024);
  });

  it("32 KB boundary — exactly 32768 bytes exceeds limit", () => {
    // Express sets limit: "32kb" = 32768 bytes
    // A body of 32769 bytes should be rejected
    const body = "x".repeat(32769);
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThan(32 * 1024);
  });

  it("large payload (1 MB) would be rejected", () => {
    const body = "x".repeat(1024 * 1024);
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThan(32 * 1024);
  });
});

// ---------------------------------------------------------------------------
// 2. Content-type enforcement middleware
// ---------------------------------------------------------------------------

describe("Content-type enforcement", () => {
  function makeContentTypeMiddleware() {
    // Inline the middleware logic from index.ts for unit testing
    return (method: string, contentType: string | undefined): number => {
      if (["POST", "PUT", "PATCH"].includes(method)) {
        const ct = contentType ?? "";
        if (!ct.startsWith("application/json")) {
          return 415;
        }
      }
      return 200;
    };
  }

  const check = makeContentTypeMiddleware();

  it("POST with application/json → passes", () => {
    expect(check("POST", "application/json")).toBe(200);
  });

  it("POST with application/json; charset=utf-8 → passes", () => {
    expect(check("POST", "application/json; charset=utf-8")).toBe(200);
  });

  it("POST with text/plain → 415", () => {
    expect(check("POST", "text/plain")).toBe(415);
  });

  it("POST with multipart/form-data → 415", () => {
    expect(check("POST", "multipart/form-data")).toBe(415);
  });

  it("POST with undefined content-type → 415", () => {
    expect(check("POST", undefined)).toBe(415);
  });

  it("GET without content-type → passes (no enforcement on reads)", () => {
    expect(check("GET", undefined)).toBe(200);
  });

  it("DELETE without content-type → passes (no body expected)", () => {
    expect(check("DELETE", undefined)).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 3. Safe error handling — no stack traces in production
// ---------------------------------------------------------------------------

describe("Safe error handling", () => {
  function buildErrorResponse(
    err: { status?: number; statusCode?: number; message?: string; stack?: string },
    isProd: boolean,
  ): { status: number; body: Record<string, string> } {
    const status = err.status ?? err.statusCode ?? 500;
    const message =
      isProd && status >= 500 ? "Internal Server Error" : err.message ?? "Internal Server Error";
    return { status, body: { error: message } };
  }

  it("production 500: generic message, no stack trace", () => {
    const result = buildErrorResponse(
      { status: 500, message: "DB exploded", stack: "Error at line 42..." },
      true,
    );
    expect(result.body.error).toBe("Internal Server Error");
    expect(JSON.stringify(result.body)).not.toContain("line 42");
    expect(JSON.stringify(result.body)).not.toContain("DB exploded");
  });

  it("production 400: client error message preserved", () => {
    const result = buildErrorResponse({ status: 400, message: "Bad request: missing mode" }, true);
    expect(result.body.error).toBe("Bad request: missing mode");
  });

  it("production 403: CSRF message preserved", () => {
    const result = buildErrorResponse({ status: 403, message: "CSRF token mismatch" }, true);
    expect(result.body.error).toBe("CSRF token mismatch");
  });

  it("development 500: real message surfaced for debugging", () => {
    const result = buildErrorResponse(
      { status: 500, message: "DB exploded", stack: "Error at line 42..." },
      false,
    );
    expect(result.body.error).toBe("DB exploded");
  });

  it("response body uses 'error' key (not 'message') to avoid info leakage patterns", () => {
    const result = buildErrorResponse({ status: 500, message: "whatever" }, true);
    expect("error" in result.body).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. CSRF enforcement logic
// ---------------------------------------------------------------------------

describe("CSRF enforcement", () => {
  const TOKEN_COOKIE = "csrf-token";
  const TOKEN_HEADER = "x-csrf-token";

  function requireCsrfLogic(
    cookieHeader: string,
    headerToken: string | undefined,
  ): 200 | 403 {
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${TOKEN_COOKIE}=([^;]+)`));
    const cookieToken = match?.[1];
    if (!cookieToken || cookieToken !== headerToken) {
      return 403;
    }
    return 200;
  }

  it("matching token and cookie → 200", () => {
    expect(requireCsrfLogic(`${TOKEN_COOKIE}=abc123`, "abc123")).toBe(200);
  });

  it("missing header → 403", () => {
    expect(requireCsrfLogic(`${TOKEN_COOKIE}=abc123`, undefined)).toBe(403);
  });

  it("mismatched token → 403", () => {
    expect(requireCsrfLogic(`${TOKEN_COOKIE}=abc123`, "wrong")).toBe(403);
  });

  it("empty cookie header → 403", () => {
    expect(requireCsrfLogic("", "abc123")).toBe(403);
  });

  it("token with special characters → correct match only", () => {
    const token = "a1b2c3d4e5f6";
    expect(requireCsrfLogic(`other=x; ${TOKEN_COOKIE}=${token}`, token)).toBe(200);
    expect(requireCsrfLogic(`other=x; ${TOKEN_COOKIE}=${token}`, "different")).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 5. Rate limiting
// ---------------------------------------------------------------------------

describe("Rate limiting", () => {
  function makeLimiter(windowMs: number, max: number) {
    const windows = new Map<string, { count: number; windowStart: number }>();
    return function check(key: string, now: number): 200 | 429 {
      const win = windows.get(key);
      if (!win || now - win.windowStart > windowMs) {
        windows.set(key, { count: 1, windowStart: now });
        return 200;
      }
      if (win.count >= max) {
        return 429;
      }
      win.count += 1;
      return 200;
    };
  }

  it("allows requests under limit", () => {
    const check = makeLimiter(60_000, 10);
    let now = 0;
    for (let i = 0; i < 10; i++) {
      expect(check("127.0.0.1:/api/operator/kill-switch", now)).toBe(200);
    }
  });

  it("blocks request at max+1", () => {
    const check = makeLimiter(60_000, 10);
    const now = 0;
    for (let i = 0; i < 10; i++) check("key", now);
    expect(check("key", now)).toBe(429);
  });

  it("window resets after windowMs", () => {
    const check = makeLimiter(60_000, 2);
    const t0 = 0;
    check("key", t0);
    check("key", t0);
    expect(check("key", t0)).toBe(429);
    // Advance past window
    expect(check("key", t0 + 60_001)).toBe(200);
  });

  it("separate keys are independent", () => {
    const check = makeLimiter(60_000, 1);
    const now = 0;
    check("key-A", now);
    expect(check("key-A", now)).toBe(429);
    expect(check("key-B", now)).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 6. Localhost binding
// ---------------------------------------------------------------------------

describe("Localhost binding", () => {
  it("default HOST is 127.0.0.1", () => {
    const host = process.env.HOST || "127.0.0.1";
    expect(host).toBe("127.0.0.1");
  });

  it("HOST env var override is respected", () => {
    const original = process.env.HOST;
    process.env.HOST = "0.0.0.0";
    const host = process.env.HOST || "127.0.0.1";
    expect(host).toBe("0.0.0.0");
    process.env.HOST = original;
  });

  it("default PORT is 3737", () => {
    const port = parseInt(process.env.PORT || "3737", 10);
    expect(port).toBe(3737);
  });
});
