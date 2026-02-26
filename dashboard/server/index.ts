import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { ensureDir, getAtlasBridgeDir } from "./config";
import { setCsrfCookie } from "./middleware/csrf";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Payload size limit — reject bodies larger than 32 KB
app.use(
  express.json({
    limit: "32kb",
    strict: true,
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(setCsrfCookie);

// Content-type enforcement for API mutation endpoints
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    const ct = req.headers["content-type"] ?? "";
    if (!ct.startsWith("application/json")) {
      res.status(415).json({ error: "Unsupported Media Type — application/json required" });
      return;
    }
  }
  next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse).substring(0, 200)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Ensure config directory exists for dashboard.db
  ensureDir(getAtlasBridgeDir());

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;

    // Never leak stack traces or internal error details to clients
    const isProd = process.env.NODE_ENV === "production";
    const message =
      isProd && status >= 500 ? "Internal Server Error" : err.message || "Internal Server Error";

    if (!isProd) {
      console.error("Internal Server Error:", err);
    } else {
      console.error(`[${status}] ${err.message ?? "unknown error"}`);
    }

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ error: message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const host = process.env.HOST || "127.0.0.1";
  const port = parseInt(process.env.PORT || "3737", 10);
  httpServer.listen({ port, host }, () => {
    log(`serving on http://${host}:${port}`);
  });
})();
