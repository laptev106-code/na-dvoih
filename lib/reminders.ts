import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import type { Wish } from "@/shared/wishlist";

export async function scheduleWishReminder(wish: Wish) {
  if (Platform.OS === "web" || !wish.reminder || !wish.date) return null;
  const date = new Date(`${wish.date}T09:00:00`);
  date.setDate(date.getDate() - 1);
  if (date.getTime() <= Date.now()) return null;

  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return null;

  return Notifications.scheduleNotificationAsync({
    content: {
      title: "На двоих",
      body: `Завтра: ${wish.title}`,
      data: { wishId: wish.id },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
  });
}

export async function cancelWishReminder(notificationId?: string) {
  if (Platform.OS === "web" || !notificationId) return;
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}
