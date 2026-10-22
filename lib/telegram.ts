import { Platform } from "react-native";

export type TelegramRuntime = {
  available: boolean;
  userId: string | null;
  theme: "light" | "dark" | null;
};

export function prepareTelegramMiniApp() {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  const webApp = (window as typeof window & { Telegram?: { WebApp?: { ready?: () => void; expand?: () => void; setHeaderColor?: (color: string) => void; setBackgroundColor?: (color: string) => void } } }).Telegram?.WebApp;
  if (!webApp) return;
  webApp.ready?.();
  webApp.expand?.();
  webApp.setHeaderColor?.("#FBF8F5");
  webApp.setBackgroundColor?.("#FBF8F5");
}

export function getTelegramRuntime(): TelegramRuntime {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return { available: false, userId: null, theme: null };
  }

  const webApp = (window as typeof window & { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { id?: number }; colorScheme?: "light" | "dark" } } } }).Telegram?.WebApp;
  const userId = webApp?.initDataUnsafe?.user?.id;
  return {
    available: Boolean(webApp),
    userId: userId ? String(userId) : null,
    theme: webApp?.initDataUnsafe?.colorScheme ?? null,
  };
}

export function getTelegramInitData() {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  return (window as typeof window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData ?? null;
}
