import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const EMPTY_IMG =
  "https://images.unsplash.com/photo-1651760680066-db9d32bd0357?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2ODh8MHwxfHNlYXJjaHwxfHxwcm9mZXNzaW9uYWwlMjBtZWRpY2FsJTIwY2xpcGJvYXJkJTIwbm90ZXMlMjBlbXB0eSUyMHN0YXRlJTIwdHJhbnNwYXJlbnR8ZW58MHx8fHwxNzgzMzc3NzA0fDA&ixlib=rb-4.1.0&q=85";

type Case = {
  case_id: string;
  name: string;
  case_ref: string;
  deceased_name: string;
  date: string;
  status: string;
  calc_count: number;
  note_count: number;
  updated_at: string;
};

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}
function initials(name: string) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

export default function CasesList() {
  const insets = useSafeAreaInsets();
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      setError(false);
      const resp = await api.get<{ cases: Case[] }>("/cases");
      setCases(resp.cases);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const filtered = cases.filter(
    (c) =>
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      (c.case_ref || "").toLowerCase().includes(query.toLowerCase()) ||
      (c.deceased_name || "").toLowerCase().includes(query.toLowerCase()),
  );

  const goNew = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    router.push("/case/new");
  };

  const renderCard = ({ item }: { item: Case }) => (
    <Pressable
      testID={`case-card-${item.case_id}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      onPress={() => router.push(`/case/${item.case_id}`)}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials(item.name)}</Text>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.cardSub} numberOfLines={1}>
          {item.case_ref ? `Ref. ${item.case_ref} · ` : ""}
          {fmtDate(item.date)}
        </Text>
        <View style={styles.metaRow}>
          <View style={styles.metaChip}>
            <Ionicons name="calculator-outline" size={13} color={colors.onSurfaceTertiary} />
            <Text style={styles.metaText}>{item.calc_count}</Text>
          </View>
          <View style={styles.metaChip}>
            <Ionicons name="document-text-outline" size={13} color={colors.onSurfaceTertiary} />
            <Text style={styles.metaText}>{item.note_count}</Text>
          </View>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
    </Pressable>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Casos</Text>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.onSurfaceTertiary} />
          <TextInput
            testID="cases-search-input"
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar por nombre, ref. o fallecido"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.searchInput}
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.onSurfaceSecondary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.onSurfaceTertiary} />
          <Text style={styles.emptyTitle}>No se pudieron cargar los casos</Text>
          <Pressable testID="cases-retry" onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Image source={EMPTY_IMG} style={styles.emptyImg} contentFit="contain" />
          <Text style={styles.emptyTitle}>
            {query ? "Sin resultados" : "Aún no hay casos"}
          </Text>
          <Text style={styles.emptySub}>
            {query ? "Prueba con otra búsqueda" : "Crea tu primer caso para empezar a documentar."}
          </Text>
        </View>
      ) : (
        <FlatList
          testID="cases-list"
          data={filtered}
          keyExtractor={(c) => c.case_id}
          renderItem={renderCard}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={colors.onSurfaceSecondary}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      <Pressable
        testID="new-case-fab"
        onPress={goNew}
        style={({ pressed }) => [styles.fab, { bottom: spacing.lg }, pressed && { opacity: 0.85 }]}
      >
        <Ionicons name="add" size={26} color={colors.onSurfaceInverse} />
        <Text style={styles.fabText}>Nuevo caso</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xxxl, marginBottom: spacing.md },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 46,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontFamily: font.regular, fontSize: fontSize.base },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  emptyImg: { width: 130, height: 130, opacity: 0.9, marginBottom: spacing.sm },
  emptyTitle: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.lg },
  emptySub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.base, textAlign: "center" },
  retryBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
  },
  retryText: { color: colors.onSurface, fontFamily: font.semibold },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.onSurfaceSecondary, fontFamily: font.semibold, fontSize: fontSize.base },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.lg },
  cardSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm },
  metaRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { color: colors.onSurfaceTertiary, fontFamily: font.mono, fontSize: fontSize.sm },
  fab: {
    position: "absolute",
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surfaceInverse,
    paddingHorizontal: spacing.lg,
    height: 52,
    borderRadius: radius.pill,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabText: { color: colors.onSurfaceInverse, fontFamily: font.semibold, fontSize: fontSize.base },
});
