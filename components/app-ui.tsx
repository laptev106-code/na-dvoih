import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";
import { categoryMeta, formatDate, type Wish } from "@/shared/wishlist";

export function AppIcon({ name, size = 22, color }: { name: React.ComponentProps<typeof MaterialIcons>["name"]; size?: number; color?: string }) {
  const colors = useColors();
  return <MaterialIcons name={name} size={size} color={color ?? colors.foreground} />;
}

export function ScreenHeader({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        {eyebrow ? <Text style={[styles.eyebrow, { color: colors.primary }]}>{eyebrow.toUpperCase()}</Text> : null}
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      </View>
      {action}
    </View>
  );
}

export function IconButton({ label, name, onPress, tone = "quiet" }: { label: string; name: React.ComponentProps<typeof MaterialIcons>["name"]; onPress: () => void; tone?: "quiet" | "primary" }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, { backgroundColor: tone === "primary" ? colors.primary : colors.surface, borderColor: tone === "primary" ? colors.primary : colors.border }, pressed && styles.pressed]}
    >
      <AppIcon name={name} size={22} color={tone === "primary" ? "#FFFFFF" : colors.foreground} />
    </Pressable>
  );
}

export function PrimaryButton({ label, onPress, icon, secondary = false, disabled = false }: { label: string; onPress: () => void; icon?: React.ComponentProps<typeof MaterialIcons>["name"]; secondary?: boolean; disabled?: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, { backgroundColor: secondary ? colors.surface : colors.primary, borderColor: secondary ? colors.border : colors.primary }, disabled && { opacity: 0.45 }, pressed && !disabled && styles.pressed]}
    >
      {icon ? <AppIcon name={icon} size={20} color={secondary ? colors.primary : "#FFFFFF"} /> : null}
      <Text style={[styles.primaryButtonText, { color: secondary ? colors.primary : "#FFFFFF" }]}>{label}</Text>
    </Pressable>
  );
}

export function SegmentedControl<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  const colors = useColors();
  return (
    <View style={[styles.segmented, { backgroundColor: colors.surface, borderColor: colors.border }]} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <Pressable key={option.value} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={option.label} onPress={() => onChange(option.value)} style={[styles.segment, selected && { backgroundColor: colors.primary }]}>
            <Text style={[styles.segmentText, { color: selected ? "#FFFFFF" : colors.muted }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function EmptyState({ icon = "auto-awesome", title, description, action }: { icon?: React.ComponentProps<typeof MaterialIcons>["name"]; title: string; description: string; action?: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.accentSoft }]}><AppIcon name={icon} size={28} color={colors.primary} /></View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.emptyDescription, { color: colors.muted }]}>{description}</Text>
      {action}
    </View>
  );
}

export function WishCard({ wish, onPress, onToggle, editable = true }: { wish: Wish; onPress: () => void; onToggle: () => void; editable?: boolean }) {
  const colors = useColors();
  const meta = categoryMeta(wish.category);
  const ownerLabel = wish.scope === "together" ? "Вместе" : wish.owner === "me" ? "Мои идеи" : "Партнёр";
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, wish.done && styles.cardDone]}>
      <Pressable accessibilityRole="button" accessibilityLabel={editable ? `Открыть желание ${wish.title}` : `Просмотреть желание партнёра ${wish.title}`} accessibilityHint={editable ? "Редактирование желания" : "Только просмотр"} onPress={editable ? onPress : undefined} style={styles.cardBody}>
        <View style={[styles.cardMark, { backgroundColor: meta.color }]} />
        <View style={styles.cardCopy}>
          <View style={styles.cardMeta}><Text style={[styles.cardCategory, { color: colors.primary }]}>{meta.label}</Text><Text style={[styles.cardOwner, { color: colors.muted }]}>{ownerLabel}</Text></View>
          <Text style={[styles.cardTitle, { color: colors.foreground }, wish.done && styles.doneText]}>{wish.title}</Text>
          {wish.note ? <Text numberOfLines={2} style={[styles.cardNote, { color: colors.muted }]}>{wish.note}</Text> : null}
          <View style={styles.cardFooter}>
            {wish.date ? <View style={styles.footerItem}><AppIcon name="event" size={15} color={colors.muted} /><Text style={[styles.footerText, { color: colors.muted }]}>{formatDate(wish.date)}</Text></View> : null}
            {wish.reminder && wish.date ? <View style={styles.footerItem}><AppIcon name="notifications-none" size={15} color={colors.muted} /><Text style={[styles.footerText, { color: colors.muted }]}>Напомнить</Text></View> : null}
          </View>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={editable ? (wish.done ? "Вернуть желание в планы" : "Отметить желание сбывшимся") : "Желание партнёра доступно только для просмотра"} accessibilityState={{ checked: wish.done, disabled: !editable }} disabled={!editable} onPress={onToggle} style={({ pressed }) => [styles.checkButton, { borderColor: wish.done ? colors.success : colors.border, backgroundColor: wish.done ? colors.success : colors.background }, !editable && styles.readOnlyCheck, pressed && styles.pressed]}>
        <AppIcon name={!editable ? "lock-outline" : wish.done ? "check" : "radio-button-unchecked"} size={20} color={wish.done ? "#FFFFFF" : colors.muted} />
      </Pressable>
    </View>
  );
}

export function FloatingAddButton({ onPress, label = "Добавить" }: { onPress: () => void; label?: string }) {
  const colors = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.fab, { backgroundColor: colors.primary, shadowColor: colors.primary }, pressed && styles.fabPressed]}><AppIcon name="add" size={24} color="#FFFFFF" /><Text style={styles.fabLabel}>{label}</Text></Pressable>;
}

export function SettingsRow({ icon, title, description, right, onPress }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; title: string; description?: string; right?: React.ReactNode; onPress?: () => void }) {
  const colors = useColors();
  const content = <><View style={[styles.settingsIcon, { backgroundColor: colors.accentSoft }]}><AppIcon name={icon} size={21} color={colors.primary} /></View><View style={styles.settingsCopy}><Text style={[styles.settingsTitle, { color: colors.foreground }]}>{title}</Text>{description ? <Text style={[styles.settingsDescription, { color: colors.muted }]}>{description}</Text> : null}</View>{right ?? (onPress ? <AppIcon name="chevron-right" size={21} color={colors.muted} /> : null)}</>;
  if (!onPress) return <View style={styles.settingsRow}>{content}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.settingsRow, pressed && styles.pressed]}>{content}</Pressable>;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18 },
  headerText: { flex: 1, gap: 4 },
  eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  title: { fontSize: 30, lineHeight: 35, fontWeight: "800", letterSpacing: -0.6 },
  iconButton: { minWidth: 48, minHeight: 48, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  primaryButton: { minHeight: 50, paddingHorizontal: 18, borderRadius: 16, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryButtonText: { fontSize: 15, fontWeight: "800" },
  pressed: { opacity: 0.72 },
  segmented: { flexDirection: "row", borderRadius: 14, borderWidth: 1, padding: 4, gap: 4 },
  segment: { flex: 1, minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  segmentText: { fontSize: 13, fontWeight: "700" },
  empty: { alignItems: "center", borderRadius: 24, borderWidth: 1, paddingHorizontal: 24, paddingVertical: 34, marginTop: 18 },
  emptyIcon: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  emptyTitle: { fontSize: 19, fontWeight: "800", textAlign: "center" },
  emptyDescription: { fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 8, maxWidth: 300 },
  card: { minHeight: 132, borderRadius: 22, borderWidth: 1, flexDirection: "row", overflow: "hidden", marginBottom: 12 },
  cardDone: { opacity: 0.72 },
  cardBody: { flex: 1, flexDirection: "row", padding: 16, gap: 13 },
  cardMark: { width: 4, borderRadius: 4, alignSelf: "stretch" },
  cardCopy: { flex: 1, gap: 5 },
  cardMeta: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  cardCategory: { fontSize: 12, fontWeight: "800" },
  cardOwner: { fontSize: 12 },
  cardTitle: { fontSize: 18, lineHeight: 23, fontWeight: "800" },
  doneText: { textDecorationLine: "line-through" },
  cardNote: { fontSize: 13, lineHeight: 18 },
  cardFooter: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 4 },
  footerItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  footerText: { fontSize: 12 },
  checkButton: { minWidth: 56, minHeight: 48, alignItems: "center", justifyContent: "center", borderLeftWidth: 1 },
  readOnlyCheck: { opacity: 0.62 },
  fab: { minHeight: 52, paddingHorizontal: 18, borderRadius: 18, flexDirection: "row", alignItems: "center", gap: 6, shadowOpacity: 0.23, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  fabLabel: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  fabPressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
  settingsRow: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 4 },
  settingsIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  settingsCopy: { flex: 1, gap: 3 },
  settingsTitle: { fontSize: 15, fontWeight: "800" },
  settingsDescription: { fontSize: 13, lineHeight: 18 },
});
