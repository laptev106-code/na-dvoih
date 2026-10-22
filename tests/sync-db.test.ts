import { describe, it, expect } from "vitest";
import { syncDb } from "../server/db";

describe("syncDb universal storage", () => {
  const testUserId1 = `user_test_${Date.now()}_1`;
  const testUserId2 = `user_test_${Date.now()}_2`;
  const coupleId = `couple_test_${Date.now()}`;
  const inviteCode = `INV_${Date.now().toString().slice(-6)}`;

  it("creates a couple and retrieves it for the owner", async () => {
    await syncDb.createCouple({
      id: coupleId,
      ownerTelegramId: testUserId1,
      inviteCode,
    });

    const couple = await syncDb.getCoupleForUser(testUserId1);
    expect(couple).not.toBeNull();
    expect(couple?.id).toBe(coupleId);
    expect(couple?.ownerTelegramId).toBe(testUserId1);
    expect(couple?.partnerTelegramId).toBeNull();
    expect(couple?.inviteCode).toBe(inviteCode);
  });

  it("joins a partner by invite code", async () => {
    const joined = await syncDb.joinCoupleByInvite(inviteCode, testUserId2);
    expect(joined).not.toBeNull();
    expect(joined?.partnerTelegramId).toBe(testUserId2);
    expect(joined?.inviteCode).toBeNull();

    // Now partner can also find the couple
    const partnerCouple = await syncDb.getCoupleForUser(testUserId2);
    expect(partnerCouple).not.toBeNull();
    expect(partnerCouple?.id).toBe(coupleId);
  });

  it("inserts and lists wishes for the couple", async () => {
    const wishId = `wish_${Date.now()}`;
    const payload = JSON.stringify({ title: "Поездка на море", category: "trip" });

    await syncDb.insertRecord("synced_wishes", {
      id: wishId,
      coupleId,
      authorTelegramId: testUserId1,
      scope: "together",
      payload,
      version: 1,
      deleted: false,
    });

    const records = await syncDb.listRecords("synced_wishes", coupleId);
    const item = records.find((r) => r.id === wishId);
    expect(item).toBeDefined();
    expect(item?.version).toBe(1);
    expect(item?.deleted).toBe(false);
    expect(item?.payload).toBe(payload);
  });

  it("updates wish with new version and deletes it", async () => {
    const wishId = `wish_del_${Date.now()}`;
    await syncDb.insertRecord("synced_wishes", {
      id: wishId,
      coupleId,
      authorTelegramId: testUserId1,
      scope: "together",
      payload: JSON.stringify({ title: "Старая запись" }),
      version: 1,
      deleted: false,
    });

    // Update
    await syncDb.updateRecord("synced_wishes", wishId, coupleId, {
      payload: JSON.stringify({ title: "Обновленная запись" }),
      version: 2,
    });

    const updated = await syncDb.getRecord("synced_wishes", wishId, coupleId);
    expect(updated?.version).toBe(2);
    expect(JSON.parse(updated?.payload || "{}").title).toBe("Обновленная запись");

    // Mark deleted
    await syncDb.markDeleted("synced_wishes", wishId, coupleId, 3);
    const deleted = await syncDb.getRecord("synced_wishes", wishId, coupleId);
    expect(deleted?.deleted).toBe(true);
    expect(deleted?.version).toBe(3);
  });
});
