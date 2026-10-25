import crypto from "node:crypto";
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

// Active SSE connections per couple: Map<coupleId, Set<Response>>
const activeRooms = new Map<string, Set<Response>>();

export async function broadcastToCouple(coupleId: string, eventType: string, data: unknown) {
  try {
    const eventId = await syncDb.recordSyncEvent(coupleId, eventType, data);
    const clients = activeRooms.get(coupleId);
    if (!clients || clients.size === 0) return;

    const payload = JSON.stringify(data);
    const sseMessage = `id: ${eventId}\nevent: ${eventType}\ndata: ${payload}\n\n`;
    for (const client of clients) {
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
export type TelegramAccount = { user: TelegramUser; authDate: number };
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

  // If raw was URL-encoded (as sent by safeHeader or URL params), decode it safely
  let workingRaw = raw;
  if (workingRaw.includes("%")) {
    try {
      workingRaw = decodeURIComponent(workingRaw);
    } catch {
      workingRaw = raw;
    }
  }

  // Dev / web user fallback for testing or non-telegram environments
  if (workingRaw.startsWith("dev_user:") || workingRaw.startsWith("web_user:")) {
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

  // If bot token is configured, enforce cryptographic signature check
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
  } else {
    // Development / unconfigured token mode: extract user safely
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

async function auth(req: Request, res: Response) {
  try {
    checkRateLimit(req);
    const initDataHeader = String(req.header("X-Telegram-Init-Data") || req.query.initData || "").trim();
    const clientUserId = String(req.header("X-Client-User-Id") || "").trim();

    if (initDataHeader) {
      return parseTelegramInitData(initDataHeader);
    }

    if (clientUserId && /^[A-Za-z0-9_.-]{4,64}$/.test(clientUserId)) {
      return {
        user: { id: clientUserId, first_name: "Пользователь", username: `web_${clientUserId.slice(0, 8)}` },
        authDate: Math.floor(Date.now() / 1000),
      };
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

export function registerTelegramSyncRoutes(app: Express) {
  // Public runtime config endpoint
  app.get("/api/config", (_req, res) => {
    res.json({
      ok: true,
      botUsername: process.env.TELEGRAM_BOT_USERNAME || "Na_dvoix2bot",
    });
  });

  // Server-Sent Events (SSE) Real-Time Stream Endpoint
  app.get("/api/stream", async (req, res) => {
    const rawInitData = String(req.query.initData || req.header("X-Telegram-Init-Data") || "").trim();
    const clientUserId = String(req.header("X-Client-User-Id") || req.query.clientUserId || "").trim();
    let account: TelegramAccount | null = null;
    if (rawInitData) {
      try {
        account = parseTelegramInitData(rawInitData);
      } catch {
        account = null;
      }
    }
    if (!account && clientUserId && /^[A-Za-z0-9_.-]{4,64}$/.test(clientUserId)) {
      account = {
        user: { id: clientUserId, first_name: "Пользователь", username: `web_${clientUserId.slice(0, 8)}` },
        authDate: Math.floor(Date.now() / 1000),
      };
    }
    if (!account) {
      return json(res, 401, { error: "telegram_auth_failed" });
    }

    const couple = await syncDb.getCoupleForUser(account.user.id);
    if (!couple) {
      return json(res, 404, { error: "pair_required" });
    }

    const coupleId = couple.id;
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

    if (!activeRooms.has(coupleId)) {
      activeRooms.set(coupleId, new Set());
    }
    activeRooms.get(coupleId)!.add(res);

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
    } else {
      const maxId = await syncDb.getMaxSyncEventId(coupleId);
      res.write(`id: ${maxId}\nevent: connected\ndata: ${JSON.stringify({ status: "ok", coupleId })}\n\n`);
    }

    // Heartbeat every 25 seconds
    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(heartbeat);
      }
    }, 25000);

    req.on("close", () => {
      clearInterval(heartbeat);
      const room = activeRooms.get(coupleId);
      if (room) {
        room.delete(res);
        if (room.size === 0) activeRooms.delete(coupleId);
      }
    });
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
