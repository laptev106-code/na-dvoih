import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { eq, or } from "drizzle-orm";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { User, InsertUser, users as mysqlUsers, couples as mysqlCouples, syncedWishes as mysqlWishes, syncedHouseholdTasks as mysqlHousehold } from "../drizzle/schema";
import { ENV } from "./_core/env";

export type CoupleRow = {
  id: string;
  ownerTelegramId: string;
  partnerTelegramId: string | null;
  inviteCode: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type SyncedRecordRow = {
  id: string;
  coupleId: string;
  authorTelegramId: string;
  scope?: "personal" | "together";
  payload: string;
  version: number;
  deleted: boolean | number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

let _mysqlDb: ReturnType<typeof drizzleMysql> | null = null;
let _sqliteDb: Database.Database | null = null;

function isMysqlConfigured(): boolean {
  const url = process.env.DATABASE_URL || "";
  return url.startsWith("mysql://") || url.startsWith("mysql2://");
}

function getSqliteDb(): Database.Database {
  if (!_sqliteDb) {
    const dataDir = path.resolve(process.cwd(), ".data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, "na-dvoih.db");
    _sqliteDb = new Database(dbPath);
    _sqliteDb.pragma("journal_mode = WAL");
    _sqliteDb.pragma("synchronous = NORMAL");
    _sqliteDb.pragma("foreign_keys = ON");
    initSqliteTables(_sqliteDb);
  }
  return _sqliteDb;
}

function initSqliteTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      openId TEXT NOT NULL UNIQUE,
      name TEXT,
      email TEXT,
      loginMethod TEXT,
      role TEXT DEFAULT 'user' NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
      lastSignedIn DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE TABLE IF NOT EXISTS couples (
      id TEXT PRIMARY KEY,
      ownerTelegramId TEXT NOT NULL UNIQUE,
      partnerTelegramId TEXT UNIQUE,
      inviteCode TEXT UNIQUE,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE TABLE IF NOT EXISTS synced_wishes (
      id TEXT PRIMARY KEY,
      coupleId TEXT NOT NULL,
      authorTelegramId TEXT NOT NULL,
      scope TEXT NOT NULL,
      payload TEXT NOT NULL,
      version INTEGER DEFAULT 1 NOT NULL,
      deleted INTEGER DEFAULT 0 NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE TABLE IF NOT EXISTS synced_household_tasks (
      id TEXT PRIMARY KEY,
      coupleId TEXT NOT NULL,
      authorTelegramId TEXT NOT NULL,
      payload TEXT NOT NULL,
      version INTEGER DEFAULT 1 NOT NULL,
      deleted INTEGER DEFAULT 0 NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_couples_owner ON couples(ownerTelegramId);
    CREATE INDEX IF NOT EXISTS idx_couples_partner ON couples(partnerTelegramId);
    CREATE INDEX IF NOT EXISTS idx_couples_invite ON couples(inviteCode);
    CREATE INDEX IF NOT EXISTS idx_wishes_couple ON synced_wishes(coupleId);
    CREATE INDEX IF NOT EXISTS idx_household_couple ON synced_household_tasks(coupleId);

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coupleId TEXT NOT NULL,
      eventType TEXT NOT NULL,
      payload TEXT NOT NULL,
      createdAt INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_sync_log_couple ON sync_log(coupleId, id);

    -- Unified entities table (Argon Field-Level LWW Schema)
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      couple_id TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      field_ts TEXT NOT NULL,
      deleted_at INTEGER DEFAULT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entities_couple_updated ON entities(couple_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_entities_couple_type ON entities(couple_id, type);

    CREATE TABLE IF NOT EXISTS processed_mutations (
      mutation_id TEXT PRIMARY KEY,
      couple_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mutations_couple ON processed_mutations(couple_id);

    CREATE TABLE IF NOT EXISTS feedbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      couple_id TEXT,
      message TEXT NOT NULL,
      meta TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);

  // Auto-migration: if entities table is empty, copy existing wishes and household tasks
  try {
    const entityCount = (db.prepare("SELECT count(*) as count FROM entities").get() as any)?.count || 0;
    if (entityCount === 0) {
      const wishes = db.prepare("SELECT * FROM synced_wishes").all() as any[];
      const tasks = db.prepare("SELECT * FROM synced_household_tasks").all() as any[];
      const insertEntity = db.prepare(`
        INSERT OR IGNORE INTO entities (id, couple_id, type, data, field_ts, deleted_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const now = Date.now();
      for (const w of wishes) {
        let payloadObj = {};
        try { payloadObj = JSON.parse(w.payload); } catch {}
        const fieldTs: Record<string, number> = {};
        for (const k of Object.keys(payloadObj)) fieldTs[k] = now;
        insertEntity.run(w.id, w.coupleId, "wish", JSON.stringify(payloadObj), JSON.stringify(fieldTs), w.deleted ? now : null, now);
      }
      for (const t of tasks) {
        let payloadObj = {};
        try { payloadObj = JSON.parse(t.payload); } catch {}
        const fieldTs: Record<string, number> = {};
        for (const k of Object.keys(payloadObj)) fieldTs[k] = now;
        insertEntity.run(t.id, t.coupleId, "chore", JSON.stringify(payloadObj), JSON.stringify(fieldTs), t.deleted ? now : null, now);
      }
      if (wishes.length > 0 || tasks.length > 0) {
        console.log(`[Database Migration] Migrated ${wishes.length} wishes and ${tasks.length} chores to unified entities table.`);
      }
    }
  } catch (err: any) {
    console.warn("[Database Migration Error]", err.message);
  }
}

export async function getDb() {
  if (isMysqlConfigured()) {
    if (!_mysqlDb) {
      try {
        _mysqlDb = drizzleMysql(process.env.DATABASE_URL!);
      } catch {
        console.warn("[Database] Failed to connect to MySQL, falling back to SQLite");
        _mysqlDb = null;
      }
    }
    if (_mysqlDb) return _mysqlDb;
  }
  // Return sqlite marker
  return getSqliteDb();
}

/** Universal Couple and Record Store API */
export const syncDb = {
  async getCoupleForUser(userId: string): Promise<CoupleRow | null> {
    if (isMysqlConfigured() && _mysqlDb) {
      const rows = await _mysqlDb
        .select()
        .from(mysqlCouples)
        .where(or(eq(mysqlCouples.ownerTelegramId, userId), eq(mysqlCouples.partnerTelegramId, userId)))
        .limit(1);
      return (rows[0] as CoupleRow) || null;
    }
    const db = getSqliteDb();
    const row = db
      .prepare("SELECT * FROM couples WHERE ownerTelegramId = ? OR partnerTelegramId = ? LIMIT 1")
      .get(userId, userId) as CoupleRow | undefined;
    return row || null;
  },

  async createCouple(couple: { id: string; ownerTelegramId: string; inviteCode: string }): Promise<void> {
    if (isMysqlConfigured() && _mysqlDb) {
      await _mysqlDb.insert(mysqlCouples).values(couple);
      return;
    }
    const db = getSqliteDb();
    db.prepare("INSERT INTO couples (id, ownerTelegramId, inviteCode) VALUES (?, ?, ?)").run(
      couple.id,
      couple.ownerTelegramId,
      couple.inviteCode
    );
  },

  async updateInviteCode(coupleId: string, inviteCode: string | null): Promise<void> {
    if (isMysqlConfigured() && _mysqlDb) {
      await _mysqlDb.update(mysqlCouples).set({ inviteCode }).where(eq(mysqlCouples.id, coupleId));
      return;
    }
    const db = getSqliteDb();
    db.prepare("UPDATE couples SET inviteCode = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?").run(inviteCode, coupleId);
  },

  async joinCoupleByInvite(inviteCode: string, partnerTelegramId: string): Promise<CoupleRow | null> {
    if (isMysqlConfigured() && _mysqlDb) {
      const rows = await _mysqlDb.select().from(mysqlCouples).where(eq(mysqlCouples.inviteCode, inviteCode)).limit(1);
      const pair = rows[0];
      if (!pair || pair.partnerTelegramId) return null;
      await _mysqlDb
        .update(mysqlCouples)
        .set({ partnerTelegramId, inviteCode: null })
        .where(eq(mysqlCouples.id, pair.id));
      return { ...(pair as CoupleRow), partnerTelegramId, inviteCode: null };
    }
    const db = getSqliteDb();
    const pair = db.prepare("SELECT * FROM couples WHERE inviteCode = ? LIMIT 1").get(inviteCode) as CoupleRow | undefined;
    if (!pair || pair.partnerTelegramId) return null;
    db.prepare("UPDATE couples SET partnerTelegramId = ?, inviteCode = NULL, updatedAt = CURRENT_TIMESTAMP WHERE id = ?").run(
      partnerTelegramId,
      pair.id
    );
    return { ...pair, partnerTelegramId, inviteCode: null };
  },

  async leaveOrDeleteCouple(coupleId: string, userId: string): Promise<void> {
    if (isMysqlConfigured() && _mysqlDb) {
      const rows = await _mysqlDb.select().from(mysqlCouples).where(eq(mysqlCouples.id, coupleId)).limit(1);
      const pair = rows[0];
      if (!pair) return;
      if (pair.ownerTelegramId === userId && !pair.partnerTelegramId) {
        await _mysqlDb.delete(mysqlCouples).where(eq(mysqlCouples.id, coupleId));
      } else if (pair.partnerTelegramId === userId) {
        await _mysqlDb.update(mysqlCouples).set({ partnerTelegramId: null }).where(eq(mysqlCouples.id, coupleId));
      } else {
        await _mysqlDb.delete(mysqlCouples).where(eq(mysqlCouples.id, coupleId));
      }
      return;
    }
    const db = getSqliteDb();
    const pair = db.prepare("SELECT * FROM couples WHERE id = ? LIMIT 1").get(coupleId) as CoupleRow | undefined;
    if (!pair) return;
    if (pair.ownerTelegramId === userId && !pair.partnerTelegramId) {
      db.prepare("DELETE FROM couples WHERE id = ?").run(coupleId);
    } else if (pair.partnerTelegramId === userId) {
      db.prepare("UPDATE couples SET partnerTelegramId = NULL, updatedAt = CURRENT_TIMESTAMP WHERE id = ?").run(coupleId);
    } else {
      db.prepare("DELETE FROM couples WHERE id = ?").run(coupleId);
    }
  },

  async listRecords(tableName: "synced_wishes" | "synced_household_tasks", coupleId: string): Promise<SyncedRecordRow[]> {
    if (isMysqlConfigured() && _mysqlDb) {
      const table = tableName === "synced_wishes" ? mysqlWishes : mysqlHousehold;
      const rows = await _mysqlDb.select().from(table as any).where(eq((table as any).coupleId, coupleId));
      return rows.map((r: any) => ({
        ...r,
        deleted: Boolean(r.deleted),
      }));
    }
    const db = getSqliteDb();
    const rows = db.prepare(`SELECT * FROM ${tableName} WHERE coupleId = ?`).all(coupleId) as SyncedRecordRow[];
    return rows.map((r) => ({
      ...r,
      deleted: Boolean(r.deleted),
    }));
  },

  async getRecord(tableName: "synced_wishes" | "synced_household_tasks", id: string, coupleId: string): Promise<SyncedRecordRow | null> {
    if (isMysqlConfigured() && _mysqlDb) {
      const table = tableName === "synced_wishes" ? mysqlWishes : mysqlHousehold;
      const rows = await _mysqlDb
        .select()
        .from(table as any)
        .where(eq((table as any).id, id))
        .limit(1);
      const row = rows[0] as any;
      if (!row || row.coupleId !== coupleId) return null;
      return { ...row, deleted: Boolean(row.deleted) };
    }
    const db = getSqliteDb();
    const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ? AND coupleId = ? LIMIT 1`).get(id, coupleId) as SyncedRecordRow | undefined;
    return row ? { ...row, deleted: Boolean(row.deleted) } : null;
  },

  async insertRecord(
    tableName: "synced_wishes" | "synced_household_tasks",
    record: { id: string; coupleId: string; authorTelegramId: string; scope?: string; payload: string; version: number; deleted: boolean }
  ): Promise<void> {
    if (isMysqlConfigured() && _mysqlDb) {
      const table = tableName === "synced_wishes" ? mysqlWishes : mysqlHousehold;
      await _mysqlDb.insert(table as any).values(record as any);
      return;
    }
    const db = getSqliteDb();
    if (tableName === "synced_wishes") {
      db.prepare(
        "INSERT INTO synced_wishes (id, coupleId, authorTelegramId, scope, payload, version, deleted) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(record.id, record.coupleId, record.authorTelegramId, record.scope || "together", record.payload, record.version, record.deleted ? 1 : 0);
    } else {
      db.prepare(
        "INSERT INTO synced_household_tasks (id, coupleId, authorTelegramId, payload, version, deleted) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(record.id, record.coupleId, record.authorTelegramId, record.payload, record.version, record.deleted ? 1 : 0);
    }
  },

  async updateRecord(
    tableName: "synced_wishes" | "synced_household_tasks",
    id: string,
    coupleId: string,
    updates: { payload?: string; version: number; deleted?: boolean; scope?: string }
  ): Promise<void> {
    if (isMysqlConfigured() && _mysqlDb) {
      const table = tableName === "synced_wishes" ? mysqlWishes : mysqlHousehold;
      await _mysqlDb.update(table as any).set(updates as any).where(eq((table as any).id, id));
      return;
    }
    const db = getSqliteDb();
    if (tableName === "synced_wishes") {
      db.prepare(
        "UPDATE synced_wishes SET payload = coalesce(?, payload), version = ?, deleted = coalesce(?, deleted), scope = coalesce(?, scope), updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND coupleId = ?"
      ).run(
        updates.payload ?? null,
        updates.version,
        updates.deleted !== undefined ? (updates.deleted ? 1 : 0) : null,
        updates.scope ?? null,
        id,
        coupleId
      );
    } else {
      db.prepare(
        "UPDATE synced_household_tasks SET payload = coalesce(?, payload), version = ?, deleted = coalesce(?, deleted), updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND coupleId = ?"
      ).run(updates.payload ?? null, updates.version, updates.deleted !== undefined ? (updates.deleted ? 1 : 0) : null, id, coupleId);
    }
  },

  async markDeleted(tableName: "synced_wishes" | "synced_household_tasks", id: string, coupleId: string, nextVersion: number): Promise<void> {
    if (isMysqlConfigured() && _mysqlDb) {
      const table = tableName === "synced_wishes" ? mysqlWishes : mysqlHousehold;
      await _mysqlDb.update(table as any).set({ deleted: true, version: nextVersion } as any).where(eq((table as any).id, id));
      return;
    }
    const db = getSqliteDb();
    db.prepare(`UPDATE ${tableName} SET deleted = 1, version = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND coupleId = ?`).run(
      nextVersion,
      id,
      coupleId
    );
  },

  async recordSyncEvent(coupleId: string, eventType: string, payload: unknown): Promise<number> {
    const db = getSqliteDb();
    const strPayload = typeof payload === "string" ? payload : JSON.stringify(payload);
    const info = db.prepare(
      "INSERT INTO sync_log (coupleId, eventType, payload) VALUES (?, ?, ?)"
    ).run(coupleId, eventType, strPayload);
    return Number(info.lastInsertRowid);
  },

  async getMissedSyncEvents(coupleId: string, lastEventId: number, limit = 100): Promise<Array<{ id: number; eventType: string; payload: string }>> {
    const db = getSqliteDb();
    const rows = db.prepare(
      "SELECT id, eventType, payload FROM sync_log WHERE coupleId = ? AND id > ? ORDER BY id ASC LIMIT ?"
    ).all(coupleId, lastEventId, limit) as Array<{ id: number; eventType: string; payload: string }>;
    return rows;
  },

  async getMaxSyncEventId(coupleId: string): Promise<number> {
    const db = getSqliteDb();
    const row = db.prepare("SELECT MAX(id) as maxId FROM sync_log WHERE coupleId = ?").get(coupleId) as { maxId: number | null } | undefined;
    return row?.maxId || 0;
  },

  /** Unified Entity API with Field-Level LWW */
  async mergeEntityMutations(
    coupleId: string,
    mutations: Array<{
      mutationId: string;
      entityId: string;
      entityType: string;
      patch: Record<string, unknown>;
      clientFieldTs?: Record<string, number>;
      isDelete?: boolean;
    }>
  ): Promise<{ processedIds: string[]; deltas: any[] }> {
    const db = getSqliteDb();
    const processedIds: string[] = [];
    const deltas: any[] = [];

    const tx = db.transaction(() => {
      const checkMutStmt = db.prepare("SELECT 1 FROM processed_mutations WHERE mutation_id = ?");
      const insertMutStmt = db.prepare("INSERT INTO processed_mutations (mutation_id, couple_id, created_at) VALUES (?, ?, ?)");
      const getEntityStmt = db.prepare("SELECT data, field_ts, deleted_at FROM entities WHERE id = ? AND couple_id = ?");
      const upsertEntityStmt = db.prepare(`
        INSERT INTO entities (id, couple_id, type, data, field_ts, deleted_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          data = excluded.data,
          field_ts = excluded.field_ts,
          deleted_at = excluded.deleted_at,
          updated_at = excluded.updated_at
      `);
      const logStmt = db.prepare("INSERT INTO sync_log (coupleId, eventType, payload) VALUES (?, 'entity:delta', ?)");

      const now = Date.now();

      for (const m of mutations) {
        if (!m.mutationId || !m.entityId || !m.entityType) continue;

        // 1. Idempotency check
        const already = checkMutStmt.get(m.mutationId);
        if (already) {
          processedIds.push(m.mutationId);
          continue;
        }

        const existing = getEntityStmt.get(m.entityId, coupleId) as { data: string; field_ts: string; deleted_at: number | null } | undefined;
        let currentData: Record<string, unknown> = {};
        let currentFieldTs: Record<string, number> = {};
        let deletedAt: number | null = null;

        if (existing) {
          try { currentData = JSON.parse(existing.data); } catch {}
          try { currentFieldTs = JSON.parse(existing.field_ts); } catch {}
          deletedAt = existing.deleted_at;
        }

        if (m.isDelete) {
          deletedAt = Math.max(now, deletedAt || 0);
        } else {
          // If entity was resurrected or created
          if (deletedAt) deletedAt = null;

          const patch = m.patch || {};
          const clientFieldTs = m.clientFieldTs || {};

          // Field-Level LWW with clock drift clamp (now + 5000ms)
          for (const [key, val] of Object.entries(patch)) {
            const incomingTs = Math.min(clientFieldTs[key] || now, now + 5000);
            const existingTs = currentFieldTs[key] || 0;

            if (incomingTs >= existingTs) {
              currentData[key] = val;
              currentFieldTs[key] = incomingTs;
            }
          }
        }

        // Upsert entity
        upsertEntityStmt.run(
          m.entityId,
          coupleId,
          m.entityType,
          JSON.stringify(currentData),
          JSON.stringify(currentFieldTs),
          deletedAt,
          now
        );

        // Record processed mutation
        insertMutStmt.run(m.mutationId, coupleId, now);
        processedIds.push(m.mutationId);

        const deltaItem = {
          entityId: m.entityId,
          entityType: m.entityType,
          data: currentData,
          fieldTs: currentFieldTs,
          deletedAt,
          updatedAt: now,
        };
        deltas.push(deltaItem);

        // Record in sync_log for SSE replay
        logStmt.run(coupleId, JSON.stringify(deltaItem));
      }
    });

    tx();
    return { processedIds, deltas };
  },

  async pullEntities(coupleId: string, since = 0): Promise<Array<{ id: string; type: string; data: any; fieldTs: any; deletedAt: number | null; updatedAt: number }>> {
    const db = getSqliteDb();
    const rows = db.prepare(`
      SELECT id, type, data, field_ts, deleted_at, updated_at
      FROM entities
      WHERE couple_id = ? AND updated_at > ?
      ORDER BY updated_at ASC
    `).all(coupleId, since) as any[];

    return rows.map((r) => {
      let data = {};
      let fieldTs = {};
      try { data = JSON.parse(r.data); } catch {}
      try { fieldTs = JSON.parse(r.field_ts); } catch {}
      return {
        id: r.id,
        type: r.type,
        data,
        fieldTs,
        deletedAt: r.deleted_at,
        updatedAt: r.updated_at,
      };
    });
  },

  async saveFeedback(userId: string, coupleId: string | null, message: string, meta?: any): Promise<number> {
    const db = getSqliteDb();
    const info = db.prepare("INSERT INTO feedbacks (user_id, couple_id, message, meta) VALUES (?, ?, ?, ?)").run(
      userId,
      coupleId,
      message,
      meta ? JSON.stringify(meta) : null
    );
    return Number(info.lastInsertRowid);
  },
};

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  if (isMysqlConfigured() && _mysqlDb) {
    await _mysqlDb.insert(mysqlUsers).values(user).onDuplicateKeyUpdate({ set: user });
    return;
  }
  const db = getSqliteDb();
  db.prepare(`
    INSERT INTO users (openId, name, email, loginMethod, role)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(openId) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      loginMethod = excluded.loginMethod,
      role = excluded.role,
      lastSignedIn = CURRENT_TIMESTAMP,
      updatedAt = CURRENT_TIMESTAMP
  `).run(user.openId, user.name ?? null, user.email ?? null, user.loginMethod ?? null, user.role ?? "user");
}

export async function getUserByOpenId(openId: string): Promise<User | undefined> {
  if (isMysqlConfigured() && _mysqlDb) {
    const result = await _mysqlDb.select().from(mysqlUsers).where(eq(mysqlUsers.openId, openId)).limit(1);
    return result[0];
  }
  const db = getSqliteDb();
  const row = db.prepare("SELECT * FROM users WHERE openId = ? LIMIT 1").get(openId) as any;
  if (!row) return undefined;
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    lastSignedIn: new Date(row.lastSignedIn),
  } as User;
}
