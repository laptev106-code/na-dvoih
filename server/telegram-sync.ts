import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import type { Express, Request, Response } from "express";
import { syncDb, CoupleRow, SyncedRecordRow } from "./db";
import { ENV } from "./_core/env";

const MAX_INIT_DATA_BYTES = 8_192;
const MAX_IMPORT_ITEMS = 500;
const MAX_RECORD_PAYLOAD_BYTES = 250_000;
const AUTH_WINDOW_SECONDS = 24 * 60 * 60;
const FUTURE_CLOCK_SKEW_SECONDS = 5 * 60;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_IP = 300;
const rateLimits = new Map<string, { count: number; resetAt: number }>();

// Stateless Session Token Secret (HMAC-SHA256)
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  (ENV.telegramBotToken
    ? crypto.createHash("sha256").update(ENV.telegramBotToken + "_session_salt_2026").digest("hex")
    : "dev_secret_na_dvoih_salt_2026");

export function signSessionToken(payload: { uid: string; cid: string | null; name?: string }): string {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
  const data = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifySessionToken(token: string): { uid: string; cid: string | null; name?: string; exp: number } | null {
  if (!token || !token.includes(".")) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expectedSig = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// In-Memory Fast Cache: userId -> coupleId
export const userCoupleCache = new Map<string, string | null>();

// In-Memory Presence & SSE Streams: coupleId -> (userId -> Response)
const coupleClients = new Map<string, Map<string, Response>>();
const presenceTimers = new Map<string, NodeJS.Timeout>();

export async function broadcastToCouple(coupleId: string, eventType: string, data: unknown) {
  try {
    const eventId = await syncDb.recordSyncEvent(coupleId, eventType, data);
    const userMap = coupleClients.get(coupleId);
    if (!userMap || userMap.size === 0) return;

    const payload = JSON.stringify(data);
    const sseMessage = `id: ${eventId}\nevent: ${eventType}\ndata: ${payload}\n\n`;
    for (const client of userMap.values()) {
      try {
        client.write(sseMessage);
      } catch {
        // broken socket cleaned up on 'close'
      }
    }
  } catch (err: any) {
    console.error("[SSE Broadcast Error]", err.message);
  }
}

export type TelegramUser = { id: string; first_name?: string; last_name?: string; username?: string };
export type TelegramAccount = { user: TelegramUser; coupleId?: string | null; authDate: number };
type SyncName = "wishes" | "household";
type TableName = "synced_wishes" | "synced_household_tasks";

const json = (res: Response, status: number, body: unknown) => res.status(status).json(body);
const bad = (code: string, status = 400) => Object.assign(new Error(code), { code, status });

function checkRateLimit(req: Request) {
  const now = Date.now();
  for (const [key, value] of rateLimits) if (value.resetAt <= now) rateLimits.delete(key);
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  current.count += 1;
  if (current.count > RATE_LIMIT_PER_IP) throw bad("rate_limited", 429);
}

export function parseTelegramInitData(raw: string): TelegramAccount {
  if (!raw) throw bad("telegram_init_data_missing", 401);

  let workingRaw = raw;
  if (workingRaw.includes("%")) {
    try {
      workingRaw = decodeURIComponent(workingRaw);
    } catch {
      workingRaw = raw;
    }
  }

  // Dev / test user fallback ONLY allowed when not in strict production with configured bot
  if (workingRaw.startsWith("dev_user:") || workingRaw.startsWith("web_user:")) {
    if (ENV.isProduction && ENV.telegramBotToken) {
      throw bad("dev_auth_disabled_in_production", 403);
    }
    const parts = workingRaw.split(":");
    const id = parts[1] || "10000001";
    let name = parts[2] ? decodeURIComponent(parts[2]) : (id === "10000002" ? "Партнёр" : "Геннадий");
    if (name === "Gennadiy" || name === "Gennady") name = "Геннадий";
    if (name === "Partner") name = "Партнёр";
    return {
      user: { id, first_name: name, username: `user_${id}` },
      authDate: Math.floor(Date.now() / 1000),
    };
  }

  if (Buffer.byteLength(workingRaw, "utf8") > MAX_INIT_DATA_BYTES) throw bad("telegram_init_data_too_large", 413);
  const params = new URLSearchParams(workingRaw);
  const hash = params.get("hash") || "";
  const authDate = Number(params.get("auth_date") || 0);
  const userRaw = params.get("user") || "";

  if (!hash || !Number.isSafeInteger(authDate) || authDate <= 0 || !userRaw) {
    throw bad("telegram_init_data_invalid", 401);
  }

  // Cryptographic signature check via HMAC-SHA256
  if (ENV.telegramBotToken) {
    const dataCheckString = [...params.entries()]
      .filter(([key]) => key !== "hash")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    const secret = crypto.createHmac("sha256", "WebAppData").update(ENV.telegramBotToken).digest();
    const expected = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
    const expectedBytes = Buffer.from(expected, "hex");
    const receivedBytes = Buffer.from(hash, "hex");

    if (expectedBytes.length !== receivedBytes.length || !crypto.timingSafeEqual(expectedBytes, receivedBytes)) {
      console.warn("[Telegram Auth] Hash verification failed with configured token");
      throw bad("telegram_init_data_invalid", 401);
    }
  } else if (ENV.isProduction) {
    throw bad("bot_token_not_configured_in_production", 500);
  }

  const age = Date.now() / 1000 - authDate;
  if (age > AUTH_WINDOW_SECONDS || age < -FUTURE_CLOCK_SKEW_SECONDS) throw bad("telegram_init_data_expired", 401);

  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw) as TelegramUser;
  } catch {
    throw bad("telegram_user_invalid", 401);
  }
  if (!user || typeof user !== "object" || !user.id || !/^[A-Za-z0-9_.-]+$/.test(String(user.id))) {
    throw bad("telegram_user_invalid", 401);
  }

  return { user: { ...user, id: String(user.id) }, authDate };
}

async function auth(req: Request, res: Response): Promise<TelegramAccount | null> {
  try {
    checkRateLimit(req);

    // 1. Session Token in Authorization Header (Primary / Zero Cross-Pair Leakage)
    const authHeader = req.header("Authorization") || "";
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      const verified = verifySessionToken(token);
      if (verified) {
        return {
          user: { id: verified.uid, first_name: verified.name || "Пользователь" },
          coupleId: verified.cid,
          authDate: Math.floor(Date.now() / 1000),
        };
      }
    }

    // 2. Query param token (used by native EventSource)
    const queryToken = String(req.query.token || "").trim();
    if (queryToken) {
      const verified = verifySessionToken(queryToken);
      if (verified) {
        return {
          user: { id: verified.uid, first_name: verified.name || "Пользователь" },
          coupleId: verified.cid,
          authDate: Math.floor(Date.now() / 1000),
        };
      }
    }

    // 3. Telegram initData header or param
    const initDataHeader = String(req.header("X-Telegram-Init-Data") || req.query.initData || req.body?.initData || "").trim();
    if (initDataHeader) {
      return parseTelegramInitData(initDataHeader);
    }

    // 4. Dev Mode only: allow client user ID if NOT in production
    if (!ENV.isProduction) {
      const clientUserId = String(req.header("X-Client-User-Id") || "").trim();
      if (clientUserId && /^[A-Za-z0-9_.-]{4,64}$/.test(clientUserId)) {
        return {
          user: { id: clientUserId, first_name: "Пользователь", username: `dev_${clientUserId.slice(0, 8)}` },
          authDate: Math.floor(Date.now() / 1000),
        };
      }
    }

    throw bad("telegram_init_data_missing", 401);
  } catch (error) {
    const e = error as { status?: number; code?: string };
    json(res, e.status || 401, { error: e.code || "telegram_auth_failed" });
    return null;
  }
}

function inviteCode() {
  // Clean, 6-digit numeric pairing code (e.g. 742891)
  return String(Math.floor(100000 + Math.random() * 900000));
}
function newId() {
  return crypto.randomUUID();
}
function decode(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
function validRecordId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function payloadFor(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw bad("invalid_payload", 400);
  const payload = { ...(raw as Record<string, unknown>) };
  delete payload.id;
  delete payload.version;
  delete payload.canEdit;
  delete payload.deleted;
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes > MAX_RECORD_PAYLOAD_BYTES) throw bad("payload_too_large", 413);
  return payload;
}

function recordId(raw: unknown) {
  return validRecordId(raw) ? raw : newId();
}

function responseKey(name: SyncName) {
  return name === "wishes" ? "item" : "task";
}
function collectionKey(name: SyncName) {
  return name === "wishes" ? "items" : "tasks";
}
function tableNameFor(name: SyncName): TableName {
  return name === "wishes" ? "synced_wishes" : "synced_household_tasks";
}

function registerResource(app: Express, name: SyncName) {
  const tableName = tableNameFor(name);
  const base = `/api/${name}`;

  app.get(base, async (req, res) => {
    const account = await auth(req, res);
    if (!account) return;
    try {
      const couple = await syncDb.getCoupleForUser(account.user.id);
      if (!couple) return json(res, 200, { [collectionKey(name)]: [], deleted: [] });
      const records = await syncDb.listRecords(tableName, couple.id);
      const mapped = records.map((row) => ({
        ...decode(row.payload),
        id: row.id,
        version: row.version,
        canEdit: name === "wishes" ? row.scope === "together" || row.authorTelegramId === account.user.id : true,
        deleted: Boolean(row.deleted),
      }));
      return json(res, 200, {
        [collectionKey(name)]: mapped.filter((item) => !item.deleted),
        deleted: mapped.filter((item) => item.deleted),
      });
    } catch (error) {
      return json(res, (error as any).status || 500, { error: (error as any).code || "sync_failed" });
    }
  });

  app.post(`${base}/import`, async (req, res) => {
    const account = await auth(req, res);
    if (!account) return;
    try {
      const couple = await syncDb.getCoupleForUser(account.user.id);
      if (!couple) throw bad("pair_required", 409);
      const incoming = req.body?.[collectionKey(name)];
      if (!Array.isArray(incoming) || incoming.length > MAX_IMPORT_ITEMS) throw bad("invalid_import", 400);

      for (const item of incoming) {
        const itemId = recordId(item?.id);
        const payload = payloadFor(item);
        const existing = await syncDb.getRecord(tableName, itemId, couple.id);
        if (existing) {
          if (existing.payload !== JSON.stringify(payload)) throw bad("item_id_conflict", 409);
          continue;
        }
        await syncDb.insertRecord(tableName, {
          id: itemId,
          coupleId: couple.id,
          authorTelegramId: account.user.id,
          scope: name === "wishes" ? (payload.scope === "personal" ? "personal" : "together") : undefined,
          payload: JSON.stringify(payload),
          version: 1,
          deleted: false,
        });
      }
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, (error as any).status || 500, { error: (error as any).code || "sync_failed" });
    }
  });

  app.put(`${base}/:id`, async (req, res) => mutateResource(req, res, tableName, name));

  app.delete(`${base}/:id`, async (req, res) => {
    const account = await auth(req, res);
    if (!account) return;
    try {
      const couple = await syncDb.getCoupleForUser(account.user.id);
      if (!couple) throw bad("pair_required", 409);
      if (!validRecordId(req.params.id)) throw bad("invalid_record_id", 400);

      const current = await syncDb.getRecord(tableName, req.params.id, couple.id);
      if (!current) return json(res, 404, { error: "not_found" });
      if (name === "wishes" && current.scope === "personal" && current.authorTelegramId !== account.user.id) {
        throw bad("forbidden", 403);
      }

      const expected = Number(req.header("If-Match"));
      if (!Number.isSafeInteger(expected) || expected !== current.version) throw bad("version_conflict", 409);

      await syncDb.markDeleted(tableName, req.params.id, couple.id, current.version + 1);
      broadcastToCouple(couple.id, `${name}:deleted`, { id: req.params.id, version: current.version + 1, authorTelegramId: account.user.id });
      return json(res, 200, { version: current.version + 1 });
    } catch (error) {
      return json(res, (error as any).status || 500, { error: (error as any).code || "sync_failed" });
    }
  });
}

async function mutateResource(req: Request, res: Response, tableName: TableName, name: SyncName) {
  const account = await auth(req, res);
  if (!account) return;
  try {
    const couple = await syncDb.getCoupleForUser(account.user.id);
    if (!couple) throw bad("pair_required", 409);
    if (!validRecordId(req.params.id)) throw bad("invalid_record_id", 400);

    const current = await syncDb.getRecord(tableName, req.params.id, couple.id);
    const incoming = req.body?.[responseKey(name)];
    const payload = payloadFor(incoming);
    const expectedRaw = req.body?.version;
    const expected = expectedRaw == null ? null : Number(expectedRaw);

    if (current) {
      if (!Number.isSafeInteger(expected) || expected !== current.version) throw bad("version_conflict", 409);
      if (name === "wishes" && current.scope === "personal" && current.authorTelegramId !== account.user.id) {
        throw bad("forbidden", 403);
      }

      await syncDb.updateRecord(tableName, req.params.id, couple.id, {
        payload: JSON.stringify(payload),
        version: current.version + 1,
        deleted: false,
        scope: name === "wishes" ? (payload.scope === "personal" ? "personal" : "together") : undefined,
      });
      const updatedItem = { ...payload, id: req.params.id, version: current.version + 1, canEdit: true };
      broadcastToCouple(couple.id, `${name}:updated`, { [responseKey(name)]: updatedItem, authorTelegramId: account.user.id });
      return json(res, 200, {
        [responseKey(name)]: updatedItem,
      });
    }

    await syncDb.insertRecord(tableName, {
      id: req.params.id,
      coupleId: couple.id,
      authorTelegramId: account.user.id,
      scope: name === "wishes" ? (payload.scope === "personal" ? "personal" : "together") : undefined,
      payload: JSON.stringify(payload),
      version: 1,
      deleted: false,
    });
    const createdItem = { ...payload, id: req.params.id, version: 1, canEdit: true };
    broadcastToCouple(couple.id, `${name}:created`, { [responseKey(name)]: createdItem, authorTelegramId: account.user.id });
    return json(res, 200, {
      [responseKey(name)]: createdItem,
    });
  } catch (error) {
    return json(res, (error as any).status || 500, { error: (error as any).code || "sync_failed" });
  }
}

function escapeTgHtml(s: any): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function sendTelegramMessage(chatId: string | number, text: string, replyMarkup?: any): Promise<boolean> {
  const token = ENV.telegramBotToken;
  if (!token) {
    console.warn("[Telegram Bot] Cannot send message: TELEGRAM_BOT_TOKEN is not configured");
    return false;
  }

  const payload = JSON.stringify({
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: replyMarkup,
  });

  const doRequest = (useProxy: boolean): Promise<boolean> => {
    return new Promise((resolve) => {
      const options = {
        hostname: "api.telegram.org",
        port: 443,
        path: `/bot${token}/sendMessage`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 10000,
      };

      if (!useProxy) {
        const req = https.request(options, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              resolve(Boolean(parsed.ok));
            } catch {
              resolve(false);
            }
          });
        });
        req.on("error", () => resolve(false));
        req.on("timeout", () => { req.destroy(); resolve(false); });
        req.write(payload);
        req.end();
      } else {
        const proxyReq = http.request({
          host: "127.0.0.1",
          port: 10809,
          method: "CONNECT",
          path: "api.telegram.org:443",
        });
        proxyReq.on("connect", (_res, socket) => {
          const req = https.request({
            ...options,
            socket,
            agent: false,
          }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
              try {
                const parsed = JSON.parse(data);
                resolve(Boolean(parsed.ok));
              } catch {
                resolve(false);
              }
            });
          });
          req.on("error", () => resolve(false));
          req.on("timeout", () => { req.destroy(); resolve(false); });
          req.write(payload);
          req.end();
        });
        proxyReq.on("error", () => resolve(false));
        proxyReq.on("timeout", () => { proxyReq.destroy(); resolve(false); });
        proxyReq.end();
      }
    });
  };

  let ok = await doRequest(false);
  if (!ok && !ENV.isProduction) {
    ok = await doRequest(true);
  }
  return ok;
}

export function registerTelegramSyncRoutes(app: Express) {
  // Public runtime config endpoint
  app.get("/api/config", (_req, res) => {
    res.json({
      ok: true,
      botUsername: process.env.TELEGRAM_BOT_USERNAME || "Na_dvoix2bot",
    });
  });

  // Session Token Exchange: POST /api/sync/session
  app.post("/api/sync/session", async (req, res) => {
    const account = await auth(req, res);
    if (!account) return;
    try {
      const couple = await syncDb.getCoupleForUser(account.user.id);
      const token = signSessionToken({
        uid: account.user.id,
        cid: couple ? couple.id : null,
        name: account.user.first_name,
      });

      return json(res, 200, {
        ok: true,
        token,
        user: account.user,
        pair: couple
          ? {
              id: couple.id,
              role: couple.ownerTelegramId === account.user.id ? "owner" : "partner",
              memberCount: couple.partnerTelegramId ? 2 : 1,
              partnerTelegramId: couple.partnerTelegramId,
              inviteCode: couple.inviteCode,
            }
          : null,
      });
    } catch (error) {
      return json(res, (error as any).status || 500, { error: (error as any).code || "auth_session_failed" });
    }
  });

  // Unified Outbox Batch Mutation: POST /api/sync/batch
  app.post("/api/sync/batch", async (req, res) => {
    const account = await auth(req, res);
    if (!account) return;
    try {
      const couple = await syncDb.getCoupleForUser(account.user.id);
      if (!couple) throw bad("pair_required", 409);

      const mutations = req.body?.mutations;
      if (!Array.isArray(mutations) || mutations.length === 0) {
        return json(res, 200, { ok: true, processedIds: [] });
      }

      if (mutations.length > 200) throw bad("too_many_mutations", 400);

      const result = await syncDb.mergeEntityMutations(couple.id, mutations);

      // Broadcast changes to partner over SSE
      if (result.deltas && result.deltas.length > 0) {
        broadcastToCouple(couple.id, "entity:delta", {
          deltas: result.deltas,
          authorId: account.user.id,
        });
      }

      return json(res, 200, {
        ok: true,
        processedIds: result.processedIds,
      });
    } catch (error) {
      return json(res, (error as any).status || 500, { error: (error as any).code || "batch_sync_failed" });
    }
  });

  // Unified Pull: GET /api/sync/pull?since=timestamp
  app.get("/api/sync/pull", async (req, res) => {
    const account = await auth(req, res);
    if (!account) return;
    try {
      const couple = await syncDb.getCoupleForUser(account.user.id);
      if (!couple) {
        return json(res, 200, { ok: true, entities: [], maxEventId: 0 });
      }

      const since = Number(req.query.since || 0);
      const entities = await syncDb.pullEntities(couple.id, since);
      const maxEventId = await syncDb.getMaxSyncEventId(couple.id);

      return json(res, 200, {
        ok: true,
        entities,
        maxEventId,
      });
    } catch (error) {
      return json(res, (error as any).status || 500, { error: (error as any).code || "pull_failed" });
    }
  });

  // Server-Sent Events (SSE) Real-Time Stream Endpoint with Lightweight Presence
  app.get("/api/stream", async (req, res) => {
    const account = await auth(req, res);
    if (!account) return;

    const couple = await syncDb.getCoupleForUser(account.user.id);
    if (!couple) {
      return json(res, 404, { error: "pair_required" });
    }

    const coupleId = couple.id;
    const userId = account.user.id;
    const lastEventId = parseInt(
      String(req.headers["last-event-id"] || req.query.lastEventId || "0"),
      10
    );

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Room registration
    if (!coupleClients.has(coupleId)) {
      coupleClients.set(coupleId, new Map());
    }
    const room = coupleClients.get(coupleId)!;
    room.set(userId, res);

    // Cancel pending disconnect timer for this user if any
    const timerKey = `${coupleId}:${userId}`;
    if (presenceTimers.has(timerKey)) {
      clearTimeout(presenceTimers.get(timerKey)!);
      presenceTimers.delete(timerKey);
    }

    // Check if partner is also connected in room
    const otherUserId = couple.ownerTelegramId === userId ? couple.partnerTelegramId : couple.ownerTelegramId;
    const isPartnerOnline = Boolean(otherUserId && room.has(otherUserId));

    // Send connection state
    const maxId = await syncDb.getMaxSyncEventId(coupleId);
    res.write(
      `id: ${maxId}\nevent: connected\ndata: ${JSON.stringify({
        status: "ok",
        coupleId,
        partnerOnline: isPartnerOnline,
      })}\n\n`
    );

    // Notify room that this user joined
    if (otherUserId && room.has(otherUserId)) {
      try {
        room.get(otherUserId)!.write(`event: presence:update\ndata: ${JSON.stringify({ partnerOnline: true })}\n\n`);
      } catch {}
    }

    // Replay missed events if client reconnected with lastEventId
    if (lastEventId > 0) {
      try {
        const missed = await syncDb.getMissedSyncEvents(coupleId, lastEventId, 100);
        for (const ev of missed) {
          res.write(`id: ${ev.id}\nevent: ${ev.eventType}\ndata: ${ev.payload}\n\n`);
        }
      } catch (err: any) {
        console.error("[SSE Replay Error]", err.message);
      }
    }

    // Heartbeat every 20 seconds
    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(heartbeat);
      }
    }, 20000);

    req.on("close", () => {
      clearInterval(heartbeat);
      const currentRoom = coupleClients.get(coupleId);
      if (currentRoom) {
        currentRoom.delete(userId);
        if (currentRoom.size === 0) {
          coupleClients.delete(coupleId);
        }
      }

      // Debounce disconnect notification by 3 seconds (protect against cell tower transitions)
      const disconnectTimer = setTimeout(() => {
        presenceTimers.delete(timerKey);
        const checkRoom = coupleClients.get(coupleId);
        if (!checkRoom || !checkRoom.has(userId)) {
          if (otherUserId && checkRoom && checkRoom.has(otherUserId)) {
            try {
              checkRoom.get(otherUserId)!.write(`event: presence:update\ndata: ${JSON.stringify({ partnerOnline: false })}\n\n`);
            } catch {}
          }
        }
      }, 3000);

      presenceTimers.set(timerKey, disconnectTimer);
    });
  });

  // Link Preview for Quick Add / Smart Paste: GET /api/link-preview?url=...
  app.get("/api/link-preview", async (req, res) => {
    try {
      const targetUrl = String(req.query.url || "").trim();
      if (!targetUrl || (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://"))) {
        return json(res, 400, { error: "invalid_url" });
      }

      // Prevent SSRF: block localhost/private IPs
      const parsed = new URL(targetUrl);
      const host = parsed.hostname.toLowerCase();
      if (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host.startsWith("192.168.") ||
        host.startsWith("10.") ||
        host.endsWith(".local")
      ) {
        return json(res, 400, { error: "forbidden_host" });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);

      const resp = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; NaDvoihBot/1.0; +https://t.me/Na_dvoix2bot)",
          "Accept": "text/html,application/xhtml+xml",
        },
      });
      clearTimeout(timeout);

      const html = await resp.text();

      // Quick regex-based OpenGraph & HTML meta tag extraction
      const getMeta = (prop: string) => {
        const match =
          html.match(new RegExp(`<meta[^>]+(?:property|name)=["'](?:og:)?${prop}["'][^>]+content=["']([^"']+)["']`, "i")) ||
          html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:)?${prop}["']`, "i"));
        return match ? match[1].trim() : null;
      };

      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = getMeta("title") || (titleMatch ? titleMatch[1].trim() : parsed.hostname);
      const description = getMeta("description") || "";
      let image = getMeta("image") || "";

      if (image && !image.startsWith("http")) {
        try {
          image = new URL(image, targetUrl).toString();
        } catch {
          image = "";
        }
      }

      const siteName = getMeta("site_name") || parsed.hostname;

      return json(res, 200, {
        ok: true,
        url: targetUrl,
        title,
        description,
        image,
        siteName,
      });
    } catch {
      return json(res, 200, { ok: false, error: "preview_fetch_failed" });
    }
  });

  // Feedback Submission: POST /api/feedback
  app.post("/api/feedback", async (req, res) => {
    try {
      const { message, meta, category } = req.body || {};
      if (!message || typeof message !== "string" || message.trim().length === 0) {
        return json(res, 400, { error: "message_required" });
      }

      let userId = "guest";
      let userName = "Пользователь приложения";
      let userUsername = "";
      let coupleId: string | null = null;
      try {
        const account = await auth(req, res);
        if (account) {
          userId = account.user.id;
          userName = account.user.first_name || account.user.username || `User #${userId}`;
          userUsername = account.user.username || "";
          const couple = await syncDb.getCoupleForUser(account.user.id);
          coupleId = couple ? couple.id : null;
        }
      } catch {}

      const cleanMeta = {
        category: category || "general",
        userName,
        userUsername,
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.header("user-agent"),
        ...(meta || {})
      };

      const id = await syncDb.saveFeedback(userId, coupleId, message.trim(), cleanMeta);
      console.log(`[Feedback Received #${id}] From User ${userId} (${userName}): ${message.trim().slice(0, 100)}`);

      // Category formatting
      const catMap: Record<string, string> = {
        idea: "💡 Идея / Предложение",
        bug: "🐞 Баг / Ошибка",
        question: "❓ Вопрос",
        thanks: "❤️ Благодарность",
        general: "💬 Обратная связь",
      };
      const catLabel = catMap[category] || "💬 Обратная связь";

      // Dispatch private notification to Gennadiy's Telegram chat or private channel
      const adminTarget = ENV.adminChatId || "136681806";
      const nowStr = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });

      const tgText = [
        `💌 <b>Новое личное обращение в «На двоих»!</b> [#${id}]`,
        ``,
        `👤 <b>От кого:</b> ${escapeTgHtml(userName)} ${userUsername ? `(@${escapeTgHtml(userUsername)})` : ""}`,
        `🆔 <b>Telegram ID:</b> <code>${escapeTgHtml(userId)}</code>`,
        `💑 <b>Пара:</b> <code>${escapeTgHtml(coupleId || "не привязана")}</code>`,
        `📂 <b>Категория:</b> ${catLabel}`,
        `🕒 <b>Время (МСК):</b> ${nowStr}`,
        ``,
        `💬 <b>Текст сообщения:</b>`,
        `<blockquote>${escapeTgHtml(message.trim())}</blockquote>`,
        ``,
        `📱 <b>Диагностика:</b>`,
        `• Платформа: <code>${escapeTgHtml(cleanMeta?.platform || "web")}</code>`,
        `• Версия: <code>${escapeTgHtml(cleanMeta?.version || "2.1.0")}</code>`,
        `• Сеть: <code>${cleanMeta?.online ? "Online" : "Offline"}</code>`,
      ].join("\n");

      const replyButtons: any[] = [];
      if (userUsername) {
        replyButtons.push([{ text: `✉️ Ответить @${userUsername} в личку`, url: `https://t.me/${userUsername}` }]);
      } else if (userId && !userId.startsWith("web_") && !userId.startsWith("dev_") && userId !== "guest") {
        replyButtons.push([{ text: `✉️ Ответить пользователю (ID: ${userId})`, url: `tg://user?id=${userId}` }]);
      }
      replyButtons.push([{ text: `👤 Личный контакт админа (@${ENV.adminUsername})`, url: `https://t.me/${ENV.adminUsername}` }]);

      sendTelegramMessage(adminTarget, tgText, { inline_keyboard: replyButtons })
        .then(sent => {
          if (sent) console.log(`[Feedback #${id}] Successfully forwarded to admin (${adminTarget})`);
          else console.warn(`[Feedback #${id}] Could not forward to admin (${adminTarget})`);
        })
        .catch(err => console.error("[Telegram Feedback Dispatch Error]", err));

      return json(res, 200, { ok: true, id, deliveredToAdmin: true });
    } catch (err: any) {
      return json(res, 500, { error: err.message || "feedback_failed" });
    }
  });

  // Telegram Bot Webhook: POST /api/telegram/webhook
  app.post("/api/telegram/webhook", async (req, res) => {
    try {
      const update = req.body;
      if (!update || !update.message) return json(res, 200, { ok: true });

      const msg = update.message;
      const senderId = String(msg.from?.id || "");
      const senderName = msg.from?.first_name || msg.from?.username || `User ${senderId}`;
      const senderUsername = msg.from?.username ? `@${msg.from.username}` : "";
      const text = String(msg.text || "").trim();
      const adminId = String(ENV.adminChatId || "136681806");

      // Case 1: Gennadiy is replying to a forwarded user message
      if (senderId === adminId && msg.reply_to_message) {
        const replyText = msg.reply_to_message.text || "";
        const match = replyText.match(/ID:\s*<code>?(\d+)<\/code>?/) || replyText.match(/ID:\s*(\d+)/);
        if (match && match[1]) {
          const targetUserId = match[1];
          const userResponseText = [
            `💬 <b>Ответ от разработчика Геннадия:</b>`,
            ``,
            escapeTgHtml(text),
            ``,
            `<i>Вы можете продолжить диалог, просто ответив на это сообщение.</i>`
          ].join("\n");
          await sendTelegramMessage(targetUserId, userResponseText);
          await sendTelegramMessage(adminId, `✅ <b>Ваш ответ доставлен пользователю (ID: ${targetUserId})!</b>`);
          return json(res, 200, { ok: true, action: "admin_reply_forwarded" });
        }
      }

      // Case 2: A regular user sends /start or text message to the bot
      if (senderId !== adminId && text) {
        if (text === "/start") {
          const welcome = [
            `Здравствуйте, <b>${escapeTgHtml(senderName)}</b>! 👋`,
            ``,
            `Это официальный бот личной связи с разработчиком приложения «На двоих».`,
            ``,
            `Напишите сюда любой вопрос, предложение или сообщение об ошибке — оно будет передано лично автору проекта Геннадию.`,
            `Никто другой ваши сообщения не увидит.`
          ].join("\n");
          await sendTelegramMessage(senderId, welcome);
          return json(res, 200, { ok: true, action: "welcome_sent" });
        }

        // Save to DB
        await syncDb.saveFeedback(senderId, null, text, {
          source: "telegram_bot_direct",
          senderName,
          senderUsername
        });

        // Forward to Gennadiy
        const adminNotification = [
          `💬 <b>Новое личное сообщение в Telegram-боте!</b>`,
          ``,
          `👤 <b>От кого:</b> ${escapeTgHtml(senderName)} ${senderUsername}`,
          `🆔 <b>Telegram ID:</b> <code>${senderId}</code>`,
          ``,
          `💬 <b>Текст:</b>`,
          `<blockquote>${escapeTgHtml(text)}</blockquote>`,
          ``,
          `<i>💡 Чтобы ответить пользователю, просто сделайте Reply (Ответить) на это сообщение в Telegram!</i>`
        ].join("\n");

        const replyMarkup = senderUsername
          ? { inline_keyboard: [[{ text: `✉️ Написать ${senderUsername}`, url: `https://t.me/${msg.from.username}` }]] }
          : undefined;

        await sendTelegramMessage(adminId, adminNotification, replyMarkup);

        // Acknowledge to user
        const ack = `Спасибо за сообщение! 🙏 Оно передано лично автору проекта Геннадию. Он прочитает его и ответит вам здесь.`;
        await sendTelegramMessage(senderId, ack);
        return json(res, 200, { ok: true, action: "forwarded_to_admin" });
      }

      return json(res, 200, { ok: true });
    } catch (err: any) {
      console.error("[Telegram Webhook Error]", err);
      return json(res, 200, { ok: true, error: err.message });
    }
  });

  app.get("/api/session", async (req, res) => {
    const account = await auth(req, res);
    if (!account) return;
    try {
      const couple = await syncDb.getCoupleForUser(account.user.id);
      return json(res, 200, {
        user: account.user,
        pair: couple
          ? {
              id: couple.id,
              role: couple.ownerTelegramId === account.user.id ? "owner" : "partner",
              memberCount: couple.partnerTelegramId ? 2 : 1,
              partnerTelegramId: couple.partnerTelegramId,
              inviteCode: couple.inviteCode,
            }
          : null,
      });
    } catch (error) {
      return json(res, (error as any).status || 500, { error: (error as any).code || "session_failed" });
    }
  });

  app.post("/api/pair", async (req, res) => {
    const account = await auth(req, res);
    if (!account) return;
    try {
      const existing = await syncDb.getCoupleForUser(account.user.id);
      if (existing) {
        // If partner is already attached, they are truly in a 2-person pair
        if (existing.partnerTelegramId) {
          throw bad("already_in_pair", 409);
        }
        // If owner created pair previously and is waiting for partner, refresh/return code!
        let code = existing.inviteCode;
        if (!code) {
          code = inviteCode();
          await syncDb.updateInviteCode(existing.id, code);
        }
        return json(res, 200, {
          pair: { id: existing.id, role: "owner", memberCount: 1, inviteCode: code },
          inviteCode: code,
        });
      }
      const code = inviteCode();
      const pair = { id: newId(), ownerTelegramId: account.user.id, inviteCode: code };
      await syncDb.createCouple(pair);
      return json(res, 200, {
        pair: { id: pair.id, role: "owner", memberCount: 1, inviteCode: code },
        inviteCode: code,
      });
    } catch (error) {
      return json(res, (error as any).status || 500, { error: (error as any).code || "pair_failed" });
    }
  });

  app.delete("/api/pair", async (req, res) => {
    const account = await auth(req, res);
    if (!account) return;
    try {
      const pair = await syncDb.getCoupleForUser(account.user.id);
      if (!pair) return json(res, 200, { ok: true });
      await syncDb.leaveOrDeleteCouple(pair.id, account.user.id);
      broadcastToCouple(pair.id, "pair:left", { userId: account.user.id });
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, (error as any).status || 500, { error: (error as any).code || "leave_failed" });
    }
  });

  app.post("/api/pair/invite", async (req, res) => {
    const account = await auth(req, res);
    if (!account) return;
    try {
      const pair = await syncDb.getCoupleForUser(account.user.id);
      if (!pair || pair.ownerTelegramId !== account.user.id) throw bad("forbidden", 403);
      if (pair.partnerTelegramId) throw bad("partner_already_joined", 409);
      const code = inviteCode();
      await syncDb.updateInviteCode(pair.id, code);
      return json(res, 200, { inviteCode: code });
    } catch (error) {
      return json(res, (error as any).status || 500, { error: (error as any).code || "invite_failed" });
    }
  });

  app.delete("/api/pair/invite", async (req, res) => {
    const account = await auth(req, res);
    if (!account) return;
    try {
      const pair = await syncDb.getCoupleForUser(account.user.id);
      if (!pair || pair.ownerTelegramId !== account.user.id || pair.partnerTelegramId) {
        throw bad("partner_already_joined", 409);
      }
      await syncDb.updateInviteCode(pair.id, null);
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, (error as any).status || 500, { error: (error as any).code || "invite_failed" });
    }
  });

  app.post("/api/pair/join", async (req, res) => {
    const account = await auth(req, res);
    if (!account) return;
    try {
      const existing = await syncDb.getCoupleForUser(account.user.id);
      if (existing && existing.partnerTelegramId) {
        throw bad("already_in_pair", 409);
      }
      const rawCode = String(req.body?.inviteCode || "").trim();
      const code = rawCode.replace(/[\s-]/g, "").toUpperCase();
      if (code.length < 4 || code.length > 32) throw bad("invite_not_found", 404);

      let pair = await syncDb.joinCoupleByInvite(code, account.user.id);
      if (!pair && rawCode !== code) {
        pair = await syncDb.joinCoupleByInvite(rawCode, account.user.id);
      }
      if (!pair) throw bad("invite_not_found", 404);

      // Broadcast to owner in real-time
      broadcastToCouple(pair.id, "pair:joined", { partnerTelegramId: account.user.id });

      return json(res, 200, { pair: { id: pair.id, role: "partner", memberCount: 2 } });
    } catch (error) {
      return json(res, (error as any).status || 500, { error: (error as any).code || "join_failed" });
    }
  });

  registerResource(app, "wishes");
  registerResource(app, "household");

  // Flight Recorder telemetry buffer: in-memory ring buffer (last 200 events)
  type TelemetryEvent = {
    time: string;
    userId?: string;
    coupleId?: string;
    type: string;
    detail?: string;
    data?: any;
  };
  const telemetryLogs: TelemetryEvent[] = [];

  app.post("/api/telemetry", async (req, res) => {
    try {
      const { type, detail, data } = req.body || {};
      let userId = "guest";
      try {
        const rawInit = String(req.header("X-Telegram-Init-Data") || req.body?.initData || "");
        if (rawInit) {
          const acc = parseTelegramInitData(rawInit);
          userId = acc.user.id;
        }
      } catch {}
      const item: TelemetryEvent = {
        time: new Date().toISOString(),
        userId,
        type: String(type || "info"),
        detail: String(detail || ""),
        data: data || null
      };
      telemetryLogs.push(item);
      if (telemetryLogs.length > 200) telemetryLogs.shift();
      return json(res, 200, { ok: true });
    } catch {
      return json(res, 200, { ok: false });
    }
  });

  app.get("/api/telemetry", async (_req, res) => {
    return json(res, 200, {
      count: telemetryLogs.length,
      logs: telemetryLogs.slice(-100)
    });
  });
}
