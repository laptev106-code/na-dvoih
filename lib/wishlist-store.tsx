import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

import { cancelWishReminder, scheduleWishReminder } from "@/lib/reminders";
import { canManageWish, EMPTY_SNAPSHOT, type HouseholdCategory, type HouseholdTask, type Wish, type WishCategory, type WishlistPreferences, type WishlistSnapshot } from "@/shared/wishlist";

const STORAGE_KEY = "na-dvoih-mobile-v1";
const RECOVERY_KEY = `${STORAGE_KEY}:recovery`;
const LEGACY_KEY = "na-dvoih-prototype-v1";

type WishDraft = Pick<Wish, "title" | "note" | "scope" | "owner" | "category" | "date" | "reminder"> & { id?: string };
type TaskDraft = Pick<HouseholdTask, "title" | "category"> & { id?: string };

type WishlistContextValue = {
  snapshot: WishlistSnapshot;
  hydrated: boolean;
  legacyAvailable: boolean;
  storageError: boolean;
  setPreferences: (preferences: Partial<WishlistPreferences>) => void;
  saveWish: (draft: WishDraft) => void;
  removeWish: (id: string) => void;
  toggleWish: (id: string) => void;
  saveTask: (draft: TaskDraft) => void;
  removeTask: (id: string) => void;
  toggleTask: (id: string) => void;
  replaceProfile: (id: "me" | "partner", name: string) => void;
  importLegacy: () => void;
  resetLocalData: () => Promise<void>;
};

const WishlistContext = createContext<WishlistContextValue | null>(null);

function normalizeSnapshot(value: unknown): WishlistSnapshot {
  if (!value || typeof value !== "object") return EMPTY_SNAPSHOT;
  const source = value as Partial<WishlistSnapshot>;
  return {
    version: 1,
    wishes: Array.isArray(source.wishes) ? source.wishes : [],
    household: Array.isArray(source.household) ? source.household : [],
    preferences: { ...EMPTY_SNAPSHOT.preferences, ...(source.preferences ?? {}) },
    profiles: Array.isArray(source.profiles) && source.profiles.length ? source.profiles : EMPTY_SNAPSHOT.profiles,
  };
}

function legacyItems() {
  if (Platform.OS !== "web" || typeof window === "undefined") return { wishes: [] as Wish[], profiles: EMPTY_SNAPSHOT.profiles };
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return { wishes: [] as Wish[], profiles: EMPTY_SNAPSHOT.profiles };
    const parsed = JSON.parse(raw) as { items?: Array<Record<string, unknown>>; profiles?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    const items = Array.isArray(parsed) ? parsed : parsed.items ?? [];
    const profileRows = Array.isArray(parsed) ? [] : parsed.profiles ?? [];
    const categoryMap: Record<string, WishCategory> = { event: "date", trip: "travel", home: "home", food: "food", fun: "fun" };
    const now = new Date().toISOString();
    const wishes = items.filter((item) => typeof item.title === "string" && item.title.trim()).map((item, index) => ({
      id: String(item.id ?? `legacy-${index}`),
      title: String(item.title).trim(),
      note: String(item.note ?? ""),
      scope: item.scope === "personal" ? "personal" : "together",
      owner: item.owner === "her" || item.owner === "partner" ? "partner" : item.scope === "together" ? "both" : "me",
      category: categoryMap[String(item.category)] ?? "date",
      done: Boolean(item.done),
      date: typeof item.date === "string" && item.date ? item.date : null,
      reminder: item.reminder !== false,
      createdAt: now,
      updatedAt: now,
      imageUri: typeof item.imageData === "string" ? item.imageData : typeof item.image === "string" ? item.image : undefined,
      source: "manual" as const,
    } satisfies Wish));
    const profiles = profileRows.length ? EMPTY_SNAPSHOT.profiles.map((profile, index) => ({ ...profile, name: String(profileRows[index]?.name ?? profile.name) })) : EMPTY_SNAPSHOT.profiles;
    return { wishes, profiles };
  } catch {
    return { wishes: [] as Wish[], profiles: EMPTY_SNAPSHOT.profiles };
  }
}

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<WishlistSnapshot>(EMPTY_SNAPSHOT);
  const [hydrated, setHydrated] = useState(false);
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then(async (raw) => {
        if (!mounted) return;
        if (raw) {
          try {
            setSnapshot(normalizeSnapshot(JSON.parse(raw)));
          } catch {
            await AsyncStorage.setItem(RECOVERY_KEY, raw).catch(() => undefined);
            setStorageError(true);
          }
        }
        const legacy = legacyItems();
        const wasImported = Platform.OS === "web" && typeof window !== "undefined" && window.localStorage.getItem(`${LEGACY_KEY}:imported`);
        setLegacyAvailable(Platform.OS === "web" && legacy.wishes.length > 0 && !wasImported);
      })
      .catch(() => setStorageError(true))
      .finally(() => mounted && setHydrated(true));
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!hydrated || storageError) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)).catch(() => undefined);
  }, [hydrated, snapshot, storageError]);

  const update = useCallback((mutator: (current: WishlistSnapshot) => WishlistSnapshot) => setSnapshot((current) => mutator(current)), []);
  const setPreferences = useCallback((preferences: Partial<WishlistPreferences>) => update((current) => ({ ...current, preferences: { ...current.preferences, ...preferences } })), [update]);

  const saveWish = useCallback((draft: WishDraft) => {
    const existing = draft.id ? snapshot.wishes.find((item) => item.id === draft.id) : undefined;
    if (existing && !canManageWish(existing)) return;
    const now = new Date().toISOString();
    const reminderChanged = Boolean(existing && (existing.date !== (draft.date || null) || existing.reminder !== draft.reminder));
    const item: Wish = {
      id: existing?.id ?? `wish-${Date.now()}`,
      title: draft.title.trim(),
      note: draft.note.trim(),
      scope: draft.scope,
      owner: draft.scope === "together" ? "both" : existing?.owner === "partner" ? "partner" : "me",
      category: draft.category,
      done: existing?.done ?? false,
      date: draft.date || null,
      reminder: draft.reminder,
      notificationId: reminderChanged ? undefined : existing?.notificationId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      imageUri: existing?.imageUri,
      source: existing?.source ?? "manual",
      sourceId: existing?.sourceId,
    };
    if (existing?.notificationId && reminderChanged) void cancelWishReminder(existing.notificationId).catch(() => undefined);
    update((current) => ({ ...current, wishes: existing ? current.wishes.map((wish) => wish.id === item.id ? item : wish) : [item, ...current.wishes] }));
    if (!existing || reminderChanged) void scheduleWishReminder(item).then((notificationId) => {
      if (!notificationId) return;
      update((current) => ({ ...current, wishes: current.wishes.map((wish) => wish.id === item.id ? { ...wish, notificationId } : wish) }));
    }).catch(() => undefined);
  }, [snapshot.wishes, update]);

  const removeWish = useCallback((id: string) => {
    const existing = snapshot.wishes.find((wish) => wish.id === id);
    if (!existing || !canManageWish(existing)) return;
    if (existing.notificationId) void cancelWishReminder(existing.notificationId).catch(() => undefined);
    update((current) => ({ ...current, wishes: current.wishes.filter((wish) => wish.id !== id) }));
  }, [snapshot.wishes, update]);

  const toggleWish = useCallback((id: string) => {
    const existing = snapshot.wishes.find((wish) => wish.id === id);
    if (!existing || !canManageWish(existing)) return;
    update((current) => ({ ...current, wishes: current.wishes.map((wish) => wish.id === id ? { ...wish, done: !wish.done, updatedAt: new Date().toISOString() } : wish) }));
  }, [snapshot.wishes, update]);

  const saveTask = useCallback((draft: TaskDraft) => update((current) => {
    const now = new Date().toISOString();
    const existing = draft.id ? current.household.find((task) => task.id === draft.id) : undefined;
    const item: HouseholdTask = { id: existing?.id ?? `task-${Date.now()}`, title: draft.title.trim(), category: draft.category, done: existing?.done ?? false, createdAt: existing?.createdAt ?? now, updatedAt: now };
    return { ...current, household: existing ? current.household.map((task) => task.id === item.id ? item : task) : [item, ...current.household] };
  }), [update]);
  const removeTask = useCallback((id: string) => update((current) => ({ ...current, household: current.household.filter((task) => task.id !== id) })), [update]);
  const toggleTask = useCallback((id: string) => update((current) => ({ ...current, household: current.household.map((task) => task.id === id ? { ...task, done: !task.done, updatedAt: new Date().toISOString() } : task) })), [update]);
  const replaceProfile = useCallback((id: "me" | "partner", name: string) => update((current) => ({ ...current, profiles: current.profiles.map((profile) => profile.id === id ? { ...profile, name: name.trim() || profile.name } : profile) })), [update]);

  const importLegacy = useCallback(() => {
    const legacy = legacyItems();
    if (!legacy.wishes.length) return;
    update((current) => ({ ...current, wishes: [...legacy.wishes.filter((wish) => !current.wishes.some((currentWish) => currentWish.id === wish.id)), ...current.wishes], profiles: current.profiles.map((profile) => ({ ...profile, name: legacy.profiles.find((candidate) => candidate.id === profile.id)?.name ?? profile.name })) }));
    if (Platform.OS === "web" && typeof window !== "undefined") window.localStorage.setItem(`${LEGACY_KEY}:imported`, new Date().toISOString());
    setLegacyAvailable(false);
  }, [update]);

  const resetLocalData = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
    setSnapshot(EMPTY_SNAPSHOT);
    setStorageError(false);
  }, []);

  const value = useMemo(() => ({ snapshot, hydrated, legacyAvailable, storageError, setPreferences, saveWish, removeWish, toggleWish, saveTask, removeTask, toggleTask, replaceProfile, importLegacy, resetLocalData }), [snapshot, hydrated, legacyAvailable, storageError, setPreferences, saveWish, removeWish, toggleWish, saveTask, removeTask, toggleTask, replaceProfile, importLegacy, resetLocalData]);
  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist() {
  const context = useContext(WishlistContext);
  if (!context) throw new Error("useWishlist must be used within WishlistProvider");
  return context;
}

export function isWishCategory(value: string): value is WishCategory { return ["date", "travel", "home", "food", "fun"].includes(value); }
export function isHouseholdCategory(value: string): value is HouseholdCategory { return ["shopping", "cleaning", "home", "other"].includes(value); }
