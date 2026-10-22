import { useMemo, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useColorScheme } from "react-native";

import { AppIcon, PrimaryButton, ScreenHeader, SettingsRow } from "@/components/app-ui";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { getTelegramRuntime } from "@/lib/telegram";
import { useThemeContext } from "@/lib/theme-provider";
import { useWishlist } from "@/lib/wishlist-store";

export default function SettingsScreen() {
  const colors = useColors();
  const systemScheme = useColorScheme() === "dark" ? "dark" : "light";
  const { setColorScheme } = useThemeContext();
  const { snapshot, legacyAvailable, storageError, importLegacy, resetLocalData, setPreferences, replaceProfile } = useWishlist();
  const telegram = useMemo(() => getTelegramRuntime(), []);
  const [editingProfile, setEditingProfile] = useState<"me" | "partner" | null>(null);
  const [profileName, setProfileName] = useState("");

  function editProfile(id: "me" | "partner") {
    setEditingProfile(id);
    setProfileName(snapshot.profiles.find((profile) => profile.id === id)?.name ?? "");
  }

  function saveProfile() {
    if (editingProfile) replaceProfile(editingProfile, profileName);
    setEditingProfile(null);
  }

  function resetData() {
    const run = () => { void resetLocalData(); };
    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (window.confirm("Начать новый локальный список?")) run();
      return;
    }
    Alert.alert("Начать новый локальный список?", "Повреждённые исходные данные останутся в recovery-копии.", [{ text: "Отмена", style: "cancel" }, { text: "Продолжить", style: "destructive", onPress: run }]);
  }

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader eyebrow="Личное пространство" title="Настройки" />
        <View style={[styles.profileCard, { backgroundColor: colors.primary }]}>
          <View style={styles.avatarRow}>
            <View style={styles.avatar}><Text style={[styles.avatarText, { color: colors.primary }]}>{snapshot.profiles[0]?.name.slice(0, 1) ?? "Я"}</Text></View>
            <View style={[styles.avatar, styles.avatarOverlap, { backgroundColor: colors.accentSoft }]}><Text style={[styles.avatarText, { color: colors.primary }]}>{snapshot.profiles[1]?.name.slice(0, 1) ?? "П"}</Text></View>
          </View>
          <View style={{ flex: 1 }}><Text style={styles.profileEyebrow}>ВАША ПАРА</Text><Text style={styles.profileTitle}>{snapshot.profiles[0]?.name} + {snapshot.profiles[1]?.name}</Text><Text style={styles.profileDescription}>Профили и оформление хранятся на этом устройстве.</Text></View>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.muted }]}>ПРОФИЛИ</Text>
        <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <SettingsRow icon="person" title={snapshot.profiles[0]?.name ?? "Я"} description="Ваш профиль" onPress={() => editProfile("me")} />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <SettingsRow icon="favorite" title={snapshot.profiles[1]?.name ?? "Партнёр"} description="Профиль партнёра" onPress={() => editProfile("partner")} />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.muted }]}>РАЗДЕЛЫ</Text>
        <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <SettingsRow icon="event" title="Календарь" description="Показывать желания с датами" right={<Switch accessibilityLabel="Включить календарь" value={snapshot.preferences.calendarEnabled} onValueChange={(value) => setPreferences({ calendarEnabled: value })} trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#FFFFFF" />} />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <SettingsRow icon="home-work" title="Наш быт" description="Общие домашние задачи" right={<Switch accessibilityLabel="Включить модуль Наш быт" value={snapshot.preferences.householdEnabled} onValueChange={(value) => setPreferences({ householdEnabled: value })} trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#FFFFFF" />} />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.muted }]}>ОФОРМЛЕНИЕ</Text>
        <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.themeRow}><View style={[styles.settingsIcon, { backgroundColor: colors.accentSoft }]}><AppIcon name="contrast" size={21} color={colors.primary} /></View><View style={styles.settingsCopy}><Text style={[styles.settingsTitle, { color: colors.foreground }]}>Тема приложения</Text><Text style={[styles.settingsDescription, { color: colors.muted }]}>Системная тема или ручной выбор</Text></View></View>
          <View style={styles.themeOptions}>{([{ value: "system", label: "Система" }, { value: "light", label: "Светлая" }, { value: "dark", label: "Тёмная" }] as const).map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ selected: snapshot.preferences.theme === option.value }} onPress={() => { setPreferences({ theme: option.value }); setColorScheme(option.value === "system" ? systemScheme : option.value); }} style={[styles.themeOption, { borderColor: snapshot.preferences.theme === option.value ? colors.primary : colors.border, backgroundColor: snapshot.preferences.theme === option.value ? colors.accentSoft : colors.background }]}><Text style={[styles.themeText, { color: snapshot.preferences.theme === option.value ? colors.primary : colors.foreground }]}>{option.label}</Text></Pressable>)}</View>
        </View>

        {legacyAvailable ? <><Text style={[styles.sectionLabel, { color: colors.muted }]}>ПЕРЕНОС ДАННЫХ</Text><View style={[styles.importCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={[styles.futureIcon, { backgroundColor: colors.accentSoft }]}><AppIcon name="history" size={20} color={colors.primary} /></View><View style={{ flex: 1, gap: 5 }}><Text style={[styles.futureTitle, { color: colors.foreground }]}>Нашли старый список</Text><Text style={[styles.futureText, { color: colors.muted }]}>Скопируйте прежние желания в mobile-пространство. Исходные browser-данные останутся нетронутыми.</Text><Pressable accessibilityRole="button" accessibilityLabel="Перенести старые желания" onPress={importLegacy} style={[styles.importButton, { backgroundColor: colors.primary }]}><Text style={styles.importButtonText}>Перенести в приложение</Text></Pressable></View></View></> : null}

        {storageError ? <><Text style={[styles.sectionLabel, { color: colors.error }]}>ВОССТАНОВЛЕНИЕ</Text><View style={[styles.recoveryCard, { backgroundColor: colors.surface, borderColor: colors.error }]}><View style={[styles.futureIcon, { backgroundColor: colors.accentSoft }]}><AppIcon name="warning-amber" size={20} color={colors.error} /></View><View style={{ flex: 1, gap: 5 }}><Text style={[styles.futureTitle, { color: colors.foreground }]}>Локальные данные повреждены</Text><Text style={[styles.futureText, { color: colors.muted }]}>Мы не перезаписываем исходник: копия сохранена для восстановления. Начните чистый список только если готовы.</Text><PrimaryButton label="Начать новый список" secondary onPress={resetData} /></View></View></> : null}

        <Text style={[styles.sectionLabel, { color: colors.muted }]}>TELEGRAM MINI APP</Text>
        <View style={[styles.statusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={styles.statusHeader}><View style={[styles.statusDot, { backgroundColor: telegram.available ? colors.success : colors.warning }]} /><Text style={[styles.statusTitle, { color: colors.foreground }]}>{telegram.available ? "Telegram подключён" : "Локальный режим"}</Text></View><Text style={[styles.statusText, { color: colors.muted }]}>{telegram.available ? `ID пользователя: ${telegram.userId ?? "не передан"}. Авторизация проверяется сервером.` : Platform.OS === "web" ? "Откройте приложение внутри Telegram, чтобы активировать Mini App runtime. Данные пока работают локально." : "Приложение готово к запуску внутри Telegram Mini App."}</Text></View>
        <View style={[styles.futureCard, { borderColor: colors.border }]}><View style={[styles.futureIcon, { backgroundColor: colors.accentSoft }]}><AppIcon name="auto-awesome" size={20} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={[styles.futureTitle, { color: colors.foreground }]}>Будущие возможности</Text><Text style={[styles.futureText, { color: colors.muted }]}>Лента «Для двоих» заложена как отдельный модуль, но пока скрыта и не содержит рекламного контента.</Text><Text style={[styles.futureFlag, { color: colors.primary }]}>offersFeed: {String(FEATURE_FLAGS.offersFeed)}</Text></View></View>
        <Text style={[styles.footer, { color: colors.muted }]}>«На двоих» · локальная версия для проверки Mini App</Text>
      </ScrollView>

      {editingProfile ? <View style={[styles.editBar, { backgroundColor: colors.background, borderColor: colors.border }]}><Text style={[styles.editTitle, { color: colors.foreground }]}>Имя профиля</Text><TextInput accessibilityLabel="Имя профиля" autoFocus value={profileName} onChangeText={setProfileName} placeholder="Например, Маша" placeholderTextColor={colors.muted} style={[styles.profileInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]} /><View style={styles.editActions}><Pressable accessibilityRole="button" accessibilityLabel="Отмена" onPress={() => setEditingProfile(null)} style={styles.cancel}><Text style={[styles.cancelText, { color: colors.muted }]}>Отмена</Text></Pressable><PrimaryButton label="Сохранить" onPress={saveProfile} /></View></View> : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 30 }, profileCard: { marginHorizontal: 20, borderRadius: 24, padding: 18, flexDirection: "row", alignItems: "center", gap: 14, minHeight: 128 }, avatarRow: { flexDirection: "row", width: 68 }, avatar: { width: 48, height: 48, borderRadius: 18, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "rgba(255,255,255,.45)" }, avatarOverlap: { marginLeft: -16 }, avatarText: { fontSize: 20, fontWeight: "900" }, profileEyebrow: { color: "#F1D9EA", fontSize: 11, fontWeight: "800", letterSpacing: 1.2 }, profileTitle: { color: "#FFFFFF", fontSize: 21, fontWeight: "800", marginTop: 3 }, profileDescription: { color: "#F1D9EA", fontSize: 12, lineHeight: 17, marginTop: 4 }, sectionLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 1.3, marginHorizontal: 24, marginTop: 24, marginBottom: 8 }, group: { marginHorizontal: 20, borderRadius: 19, borderWidth: 1, paddingHorizontal: 12 }, separator: { height: 1, marginLeft: 55 }, settingsIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" }, settingsCopy: { flex: 1, gap: 3 }, settingsTitle: { fontSize: 15, fontWeight: "800" }, settingsDescription: { fontSize: 13, lineHeight: 18 }, themeRow: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 13 }, themeOptions: { flexDirection: "row", gap: 8, paddingBottom: 13, paddingLeft: 55 }, themeOption: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }, themeText: { fontSize: 12, fontWeight: "700" }, importCard: { marginHorizontal: 20, borderWidth: 1, borderRadius: 19, padding: 15, flexDirection: "row", gap: 11 }, recoveryCard: { marginHorizontal: 20, borderWidth: 1, borderRadius: 19, padding: 15, flexDirection: "row", gap: 11 }, importButton: { alignSelf: "flex-start", minHeight: 48, paddingHorizontal: 12, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 4 }, importButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" }, statusCard: { marginHorizontal: 20, borderWidth: 1, borderRadius: 19, padding: 16 }, statusHeader: { flexDirection: "row", alignItems: "center", gap: 8 }, statusDot: { width: 10, height: 10, borderRadius: 5 }, statusTitle: { fontSize: 15, fontWeight: "800" }, statusText: { fontSize: 13, lineHeight: 19, marginTop: 9 }, futureCard: { marginHorizontal: 20, marginTop: 12, borderWidth: 1, borderRadius: 19, padding: 15, flexDirection: "row", gap: 11 }, futureIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" }, futureTitle: { fontSize: 14, fontWeight: "800" }, futureText: { fontSize: 12, lineHeight: 18, marginTop: 4 }, futureFlag: { fontSize: 11, fontWeight: "800", marginTop: 7 }, footer: { textAlign: "center", fontSize: 12, paddingVertical: 28 }, editBar: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopWidth: 1, padding: 18, gap: 8 }, editTitle: { fontSize: 14, fontWeight: "800" }, profileInput: { minHeight: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontSize: 16 }, editActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 12 }, cancel: { minHeight: 50, paddingHorizontal: 12, justifyContent: "center" }, cancelText: { fontSize: 14, fontWeight: "700" } });
