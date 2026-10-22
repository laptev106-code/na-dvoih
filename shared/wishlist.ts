export type WishScope = "personal" | "together";
export type WishOwner = "me" | "partner" | "both";
export type WishCategory = "date" | "travel" | "home" | "food" | "fun";

export type Wish = {
  id: string;
  title: string;
  note: string;
  scope: WishScope;
  owner: WishOwner;
  category: WishCategory;
  done: boolean;
  date: string | null;
  reminder: boolean;
  notificationId?: string;
  createdAt: string;
  updatedAt: string;
  imageUri?: string;
  source?: "manual" | "offer";
  sourceId?: string;
};

export type HouseholdCategory = "shopping" | "cleaning" | "home" | "other";

export type HouseholdTask = {
  id: string;
  title: string;
  category: HouseholdCategory;
  done: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Profile = {
  id: "me" | "partner";
  name: string;
  subtitle: string;
};

export type WishlistPreferences = {
  calendarEnabled: boolean;
  householdEnabled: boolean;
  theme: "system" | "light" | "dark";
};

export type WishlistSnapshot = {
  version: 1;
  wishes: Wish[];
  household: HouseholdTask[];
  preferences: WishlistPreferences;
  profiles: Profile[];
};

export const WISH_CATEGORIES: Array<{ id: WishCategory; label: string; icon: string; color: string }> = [
  { id: "date", label: "Свидание", icon: "favorite", color: "#F4B6A8" },
  { id: "travel", label: "Поездки", icon: "flight-takeoff", color: "#B9D7D5" },
  { id: "home", label: "Дом", icon: "home", color: "#E7D4B5" },
  { id: "food", label: "Еда", icon: "restaurant", color: "#F0C7D9" },
  { id: "fun", label: "Развлечения", icon: "celebration", color: "#C9C2E8" },
];

export const HOUSEHOLD_CATEGORIES: Array<{ id: HouseholdCategory; label: string; icon: string }> = [
  { id: "shopping", label: "Покупки", icon: "shopping-basket" },
  { id: "cleaning", label: "Уборка", icon: "cleaning-services" },
  { id: "home", label: "Дом и ремонт", icon: "home-repair-service" },
  { id: "other", label: "Другие дела", icon: "more-horiz" },
];

export const EMPTY_SNAPSHOT: WishlistSnapshot = {
  version: 1,
  wishes: [],
  household: [],
  preferences: {
    calendarEnabled: true,
    householdEnabled: false,
    theme: "system",
  },
  profiles: [
    { id: "me", name: "Я", subtitle: "Мои идеи" },
    { id: "partner", name: "Партнёр", subtitle: "Идеи партнёра" },
  ],
};

export function categoryMeta(category: WishCategory) {
  return WISH_CATEGORIES.find((item) => item.id === category) ?? WISH_CATEGORIES[0];
}

export function householdCategoryMeta(category: HouseholdCategory) {
  return HOUSEHOLD_CATEGORIES.find((item) => item.id === category) ?? HOUSEHOLD_CATEGORIES[0];
}

export function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function formatDate(value: string | null) {
  if (!value) return "Без даты";
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function dayDistance(value: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(`${value}T00:00:00`);
  date.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86400000);
}

/** The current local device represents the "me" profile. Personal partner wishes are read-only. */
export function canManageWish(wish: Wish) {
  return wish.scope === "together" || wish.owner === "me";
}
