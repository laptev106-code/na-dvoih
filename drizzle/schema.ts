import { boolean, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/** Core user table backing the existing Manus auth flow. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const couples = mysqlTable("couples", {
  id: varchar("id", { length: 64 }).primaryKey(),
  ownerTelegramId: varchar("ownerTelegramId", { length: 32 }).notNull().unique(),
  partnerTelegramId: varchar("partnerTelegramId", { length: 32 }).unique(),
  inviteCode: varchar("inviteCode", { length: 32 }).unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const syncedWishes = mysqlTable("synced_wishes", {
  id: varchar("id", { length: 160 }).primaryKey(),
  coupleId: varchar("coupleId", { length: 64 }).notNull(),
  authorTelegramId: varchar("authorTelegramId", { length: 32 }).notNull(),
  scope: mysqlEnum("scope", ["personal", "together"]).notNull(),
  payload: text("payload").notNull(),
  version: int("version").notNull().default(1),
  deleted: boolean("deleted").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const syncedHouseholdTasks = mysqlTable("synced_household_tasks", {
  id: varchar("id", { length: 160 }).primaryKey(),
  coupleId: varchar("coupleId", { length: 64 }).notNull(),
  authorTelegramId: varchar("authorTelegramId", { length: 32 }).notNull(),
  payload: text("payload").notNull(),
  version: int("version").notNull().default(1),
  deleted: boolean("deleted").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
