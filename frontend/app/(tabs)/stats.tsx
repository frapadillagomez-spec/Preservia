import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";
import { fmtDateMx } from "@/src/utils/mxtime";
import { BrandBar } from "@/src/components/BrandLogo";

type Totals = {
  cases: number;
  calculations: number;
  notes: number;
  active_cases: number;
  archived_cases: number;
  cases_last_30_days: number;
};
type Monthly = { key: string; label: string; count: number };
type CalcBreak = { type: string; label: string; count: number };
type RecentCase = {
  case_id: string;
  name: string;
  case_ref: string;
  status: string;
  calc_count: number;
  updated_at: string;
  date: string;
};
type Stats = {
  totals: Totals;
  monthly: Monthly[];
  calc_breakdown: CalcBreak[];
  recent_cases: RecentCase[];
};

function fmtDate(iso: string) {
  return fmtDateMx(iso);
}

const CALC_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  volume: "flask-outline",
  lbm: "body-outline",
  concentration: "beaker-outline",
};

export default function StatsScreen() {
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      const resp = await api.get<Stats>("/stats");
      setStats(resp);
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

  if (loading) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.onSurfaceSecondary} />
      </View>
    );
  }
  if (error || !stats) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Ionicons name="cloud-offline-outline" size={40} color={colors.onSurfaceTertiary} />
        <Text style={styles.emptyTitle}>No se pudieron cargar las estadísticas</Text>
        <Pressable testID="stats-retry" onPress={load} style={styles.retryBtn}>
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  const { totals, monthly, calc_breakdown, recent_cases } = stats;
  const maxMonth = Math.max(1, ...monthly.map((m) => m.count));
  const maxCalc = Math.max(1, ...calc_breakdown.map((c) => c.count));

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <BrandBar />
      <View style={styles.header}>
        <Text style={styles.title}>Historial</Text>
      </View>

      <ScrollView
        testID="stats-scroll"
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
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
      >
        {/* Summary cards */}
        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Ionicons name="folder-open-outline" size={20} color={colors.onSurfaceSecondary} />
            <Text testID="stat-cases" style={styles.statNum}>{totals.cases}</Text>
            <Text style={styles.statLabel}>Casos</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="calculator-outline" size={20} color={colors.onSurfaceSecondary} />
            <Text testID="stat-calcs" style={styles.statNum}>{totals.calculations}</Text>
            <Text style={styles.statLabel}>Cálculos</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="document-text-outline" size={20} color={colors.onSurfaceSecondary} />
            <Text testID="stat-notes" style={styles.statNum}>{totals.notes}</Text>
            <Text style={styles.statLabel}>Notas</Text>
          </View>
        </View>

        <View style={styles.pillRow}>
          <View style={styles.pill}>
            <Ionicons name="pulse-outline" size={14} color={colors.success} />
            <Text style={styles.pillText}>{totals.cases_last_30_days} en los últimos 30 días</Text>
          </View>
          <View style={styles.pill}>
            <Ionicons name="checkmark-circle-outline" size={14} color={colors.info} />
            <Text style={styles.pillText}>{totals.active_cases} activos</Text>
          </View>
        </View>

        {/* Monthly chart */}
        <Text style={styles.sectionLabel}>Casos por mes</Text>
        <View style={styles.chartCard}>
          <View style={styles.chart}>
            {monthly.map((m) => (
              <View key={m.key} style={styles.barCol}>
                <Text style={styles.barValue}>{m.count > 0 ? m.count : ""}</Text>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { height: `${Math.round((m.count / maxMonth) * 100)}%` },
                      m.count === 0 && styles.barEmpty,
                    ]}
                  />
                </View>
                <Text style={styles.barLabel}>{m.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Calc breakdown */}
        <Text style={styles.sectionLabel}>Cálculos por tipo</Text>
        <View style={styles.breakCard}>
          {calc_breakdown.map((c) => (
            <View key={c.type} style={styles.breakRow}>
              <Ionicons name={CALC_ICONS[c.type]} size={18} color={colors.onSurfaceSecondary} />
              <View style={styles.breakBody}>
                <View style={styles.breakHead}>
                  <Text style={styles.breakLabel} numberOfLines={1}>{c.label}</Text>
                  <Text style={styles.breakCount}>{c.count}</Text>
                </View>
                <View style={styles.breakTrack}>
                  <View style={[styles.breakFill, { width: `${Math.round((c.count / maxCalc) * 100)}%` }]} />
                </View>
              </View>
            </View>
          ))}
        </View>

        {/* Recent activity */}
        <Text style={styles.sectionLabel}>Actividad reciente</Text>
        {recent_cases.length === 0 ? (
          <Text style={styles.emptyInline}>Aún no hay actividad registrada.</Text>
        ) : (
          recent_cases.map((c) => (
            <Pressable
              key={c.case_id}
              testID={`recent-case-${c.case_id}`}
              style={({ pressed }) => [styles.recentRow, pressed && { opacity: 0.85 }]}
              onPress={() => router.push(`/case/${c.case_id}`)}
            >
              <View style={styles.recentIcon}>
                <Ionicons name="time-outline" size={18} color={colors.onSurfaceSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.recentTitle} numberOfLines={1}>{c.name}</Text>
                <Text style={styles.recentSub} numberOfLines={1}>
                  {c.case_ref ? `Ref. ${c.case_ref} · ` : ""}
                  Actualizado {fmtDate(c.updated_at)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { alignItems: "center", justifyContent: "center", gap: spacing.md },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xxxl },
  emptyTitle: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.lg, textAlign: "center" },
  emptyInline: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.base },
  retryBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
  },
  retryText: { color: colors.onSurface, fontFamily: font.semibold },
  statRow: { flexDirection: "row", gap: spacing.md },
  statCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    alignItems: "center",
    gap: spacing.xs,
  },
  statNum: { color: colors.onSurface, fontFamily: font.monoSemibold, fontSize: fontSize.xxl },
  statLabel: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm },
  pillRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, flexWrap: "wrap" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  pillText: { color: colors.onSurfaceSecondary, fontFamily: font.medium, fontSize: fontSize.sm },
  sectionLabel: {
    color: colors.onSurfaceTertiary,
    fontFamily: font.medium,
    fontSize: fontSize.sm,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  chartCard: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  chart: { flexDirection: "row", alignItems: "flex-end", height: 160, gap: spacing.sm },
  barCol: { flex: 1, alignItems: "center", height: "100%", justifyContent: "flex-end" },
  barValue: { color: colors.onSurfaceSecondary, fontFamily: font.mono, fontSize: fontSize.sm, marginBottom: 4 },
  barTrack: { flex: 1, width: "70%", justifyContent: "flex-end" },
  barFill: {
    width: "100%",
    minHeight: 4,
    backgroundColor: colors.info,
    borderRadius: radius.sm,
  },
  barEmpty: { backgroundColor: colors.surfaceTertiary },
  barLabel: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: spacing.sm },
  breakCard: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  breakRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  breakBody: { flex: 1, gap: spacing.xs },
  breakHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  breakLabel: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: fontSize.base },
  breakCount: { color: colors.onSurfaceSecondary, fontFamily: font.monoSemibold, fontSize: fontSize.base },
  breakTrack: { height: 8, backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm, overflow: "hidden" },
  breakFill: { height: "100%", backgroundColor: colors.onSurfaceSecondary, borderRadius: radius.sm },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  recentIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  recentTitle: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base },
  recentSub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2 },
});
