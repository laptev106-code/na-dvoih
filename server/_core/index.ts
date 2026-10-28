import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { createCorsMiddleware } from "./cors";
import { clearLegacySessionCookie } from "./cookies";
import { registerTelegramSyncRoutes } from "../telegram-sync";
import { registerLinkPreviewRoute } from "../link-preview";

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");

  app.use(createCorsMiddleware());
  app.use(clearLegacySessionCookie());
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use(express.json({ limit: "8mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerTelegramSyncRoutes(app);
  registerLinkPreviewRoute(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  // The published Telegram Mini App directly serves the client without iframe nesting.
  const primaryClientDir = resolve(process.cwd(), "public/na-dvoih-original");
  const fallbackWebRoot = resolve(process.cwd(), "dist-web");
  const clientDir = existsSync(join(primaryClientDir, "index.html")) ? primaryClientDir : fallbackWebRoot;

  app.use(express.static(clientDir, { index: "index.html" }));
  app.use(express.static(resolve(process.cwd(), "public"), { index: false }));

  app.get(["/", "/na-dvoih", "/na-dvoih/*"], (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(join(clientDir, "index.html"));
  });

  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    const requested = req.path === "/" ? "/index.html" : req.path.endsWith(".html") ? req.path : `${req.path}.html`;
    const candidate = resolve(clientDir, `.${requested}`);
    if (candidate.startsWith(clientDir) && existsSync(candidate)) return res.sendFile(candidate);
    const fallback = join(clientDir, "index.html");
    if (existsSync(fallback)) return res.sendFile(fallback);
    return next();
  });

  const port = parseInt(process.env.PORT || "3000");
  server.listen(port, "0.0.0.0", () => {
    console.log(`[api] server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch(() => {
  console.error("[api] server failed to start");
});
