import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getArticle } from "@/src/data/reference";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function ArticleDetail() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const article = getArticle(id || "");

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Pressable testID="article-back" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {article?.title || "Referencia"}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      {!article ? (
        <View style={styles.center}>
          <Text style={styles.body}>Artículo no encontrado.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Ionicons name={article.icon} size={26} color={colors.onSurface} />
            </View>
            <Text style={styles.title}>{article.title}</Text>
            <Text style={styles.summary}>{article.summary}</Text>
          </View>

          {article.sections.map((s, i) => (
            <View key={i} style={styles.section}>
              {s.heading && <Text style={styles.sectionHeading}>{s.heading}</Text>}
              {s.body && <Text style={styles.body}>{s.body}</Text>}
              {s.bullets?.map((b, bi) => (
                <View key={bi} style={styles.bulletRow}>
                  <View style={styles.dot} />
                  <Text style={styles.bulletText}>{b}</Text>
                </View>
              ))}
            </View>
          ))}

          {article.table && (
            <View style={styles.tableWrap}>
              <Text style={styles.sectionHeading}>{article.table.title}</Text>
              <View style={styles.table}>
                <View style={styles.tableHeaderRow}>
                  {article.table.data.columns.map((c, ci) => (
                    <Text key={ci} style={[styles.th, ci === 0 && { flex: 1.4 }]}>
                      {c}
                    </Text>
                  ))}
                </View>
                {article.table.data.rows.map((row, ri) => (
                  <View key={ri} style={[styles.tableRow, ri % 2 === 1 && styles.tableRowAlt]}>
                    {row.map((cell, cx) => (
                      <Text key={cx} style={[styles.td, cx === 0 ? { flex: 1.4 } : styles.tdMono]}>
                        {cell}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.lg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  hero: { marginBottom: spacing.lg },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xxl },
  summary: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.base, marginTop: spacing.xs, lineHeight: 21 },
  section: { marginTop: spacing.lg },
  sectionHeading: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.lg, marginBottom: spacing.sm },
  body: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: fontSize.base, lineHeight: 22 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginTop: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brand, marginTop: 8 },
  bulletText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: fontSize.base, lineHeight: 22 },
  tableWrap: { marginTop: spacing.xl },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: "hidden" },
  tableHeaderRow: { flexDirection: "row", backgroundColor: colors.surfaceTertiary, paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  th: { flex: 1, color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.sm },
  tableRow: { flexDirection: "row", paddingVertical: spacing.md, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceSecondary },
  tableRowAlt: { backgroundColor: colors.surface },
  td: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: fontSize.sm },
  tdMono: { flex: 1, color: colors.onSurface, fontFamily: font.monoMedium, fontSize: fontSize.sm },
});
