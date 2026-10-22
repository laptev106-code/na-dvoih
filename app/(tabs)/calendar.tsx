import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { EmptyState, ScreenHeader, WishCard } from "@/components/app-ui";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useWishlist } from "@/lib/wishlist-store";
import { dayDistance, formatDate } from "@/shared/wishlist";

export default function CalendarScreen() {
  const colors = useColors();
  const router = useRouter();
  const { snapshot, toggleWish, setPreferences } = useWishlist();
  const dated = useMemo(() => snapshot.wishes.filter((wish) => wish.date).sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.title.localeCompare(b.title, "ru")), [snapshot.wishes]);
  const upcoming = dated.filter((wish) => !wish.done && dayDistance(wish.date ?? "") >= 0);
  const overdue = dated.filter((wish) => !wish.done && dayDistance(wish.date ?? "") < 0);
  const monthKey = new Date().toISOString().slice(0, 7);
  const monthItems = dated.filter((wish) => wish.date?.startsWith(monthKey));

  if (!snapshot.preferences.calendarEnabled) {
    return <ScreenContainer><ScrollView contentContainerStyle={styles.content}><ScreenHeader eyebrow="Планы" title="Календарь" /><EmptyState icon="event-busy" title="Календарь скрыт" description="Включите календарь в настройках, чтобы видеть желания с датой в одном месте." action={<View style={{ width: "100%", marginTop: 18 }}><Pressable accessibilityRole="button" accessibilityLabel="Включить календарь" onPress={() => setPreferences({ calendarEnabled: true })} style={[styles.enableButton, { backgroundColor: colors.primary }]}><Text style={styles.enableText}>Включить календарь</Text></Pressable></View>} /></ScrollView></ScreenContainer>;
  }

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader eyebrow="Планы" title="Календарь" />
        <Text style={[styles.subtitle, { color: colors.muted }]}>Даты живут внутри желаний — здесь ничего не дублируется.</Text>
        {upcoming.length || overdue.length ? <>
          {upcoming.length ? <Section title="Скоро" count={upcoming.length} tone="primary"><View>{upcoming.map((wish) => <WishCard key={wish.id} wish={wish} onPress={() => router.replace("/")} onToggle={() => toggleWish(wish.id)} />)}</View></Section> : null}
          {overdue.length ? <Section title="Пора вспомнить" count={overdue.length} tone="warning"><View>{overdue.map((wish) => <WishCard key={wish.id} wish={wish} onPress={() => router.replace("/")} onToggle={() => toggleWish(wish.id)} />)}</View></Section> : null}
        </> : <EmptyState icon="event" title="Дат пока нет" description="Добавьте дату к желанию, чтобы увидеть его здесь и получать локальное напоминание за день до события." />}
        <Section title={new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(new Date()).replace(/^./, (char) => char.toUpperCase())} count={monthItems.length} tone="neutral">
          {monthItems.length ? <View style={[styles.monthCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>{monthItems.map((wish) => <Pressable key={wish.id} accessibilityRole="button" accessibilityLabel={`Открыть ${wish.title}`} onPress={() => router.replace("/")} style={styles.monthRow}><View style={[styles.dayBadge, { backgroundColor: colors.accentSoft }]}><Text style={[styles.dayNumber, { color: colors.primary }]}>{wish.date?.slice(-2)}</Text><Text style={[styles.dayMonth, { color: colors.primary }]}>{wish.date ? formatDate(wish.date).split(" ")[1] : ""}</Text></View><View style={{ flex: 1 }}><Text style={[styles.monthTitle, { color: colors.foreground }]}>{wish.title}</Text><Text style={[styles.monthMeta, { color: colors.muted }]}>{wish.done ? "Сбылось" : wish.scope === "together" ? "Вместе" : "Личное"}</Text></View><Text style={[styles.chevron, { color: colors.muted }]}>›</Text></Pressable>)}</View> : <Text style={[styles.noMonth, { color: colors.muted }]}>В этом месяце нет датированных планов.</Text>}
        </Section>
      </ScrollView>
    </ScreenContainer>
  );
}

function Section({ title, count, tone, children }: { title: string; count: number; tone: "primary" | "warning" | "neutral"; children: React.ReactNode }) {
  const colors = useColors();
  const color = tone === "warning" ? colors.warning : tone === "primary" ? colors.primary : colors.muted;
  return <View style={styles.section}><View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text><View style={[styles.countPill, { backgroundColor: tone === "neutral" ? colors.accentSoft : `${color}20` }]}><Text style={[styles.countText, { color }]}>{count}</Text></View></View>{children}</View>;
}

const styles = StyleSheet.create({
  content: { paddingBottom: 36 },
  subtitle: { marginHorizontal: 20, marginTop: -8, marginBottom: 18, fontSize: 14, lineHeight: 20 },
  section: { marginHorizontal: 20, marginBottom: 18 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 19, fontWeight: "800" },
  countPill: { minWidth: 26, height: 26, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 7 },
  countText: { fontSize: 12, fontWeight: "800" },
  monthCard: { borderWidth: 1, borderRadius: 21, overflow: "hidden" },
  monthRow: { minHeight: 76, padding: 12, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: "#E8DFE5" },
  dayBadge: { width: 48, height: 52, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  dayNumber: { fontSize: 18, lineHeight: 20, fontWeight: "800" },
  dayMonth: { fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  monthTitle: { fontSize: 15, fontWeight: "800" },
  monthMeta: { fontSize: 12, marginTop: 3 },
  chevron: { fontSize: 26 },
  noMonth: { fontSize: 14, paddingVertical: 8 },
  enableButton: { minHeight: 50, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  enableText: { color: "#FFFFFF", fontWeight: "800", fontSize: 15 },
});
