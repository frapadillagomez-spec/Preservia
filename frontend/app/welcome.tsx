import { useRef, useState } from "react";
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { storage } from "@/src/utils/storage";
import { BrandLogo } from "@/src/components/BrandLogo";
import { Button } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const { width } = Dimensions.get("window");
const WELCOME_KEY = "preservia_seen_welcome";

type Slide = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
};

const SLIDES: Slide[] = [
  {
    key: "cases",
    icon: "folder-open-outline",
    title: "Gestión de casos",
    desc: "Organiza y consulta tus casos de tanatopraxia de forma privada y segura desde cualquier lugar.",
  },
  {
    key: "calc",
    icon: "calculator-outline",
    title: "Calculadoras técnicas",
    desc: "Volumen de solución, masa magra corporal y diluciones con el asistente C1·V1 = C2·V2.",
  },
  {
    key: "pdf",
    icon: "document-text-outline",
    title: "Reportes en PDF",
    desc: "Genera reportes profesionales por caso con tus cálculos y notas, listos para compartir.",
  },
];

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState({ width, height: 0 });

  const total = SLIDES.length + 1; // +1 for the intro/brand slide

  const finish = async () => {
    await storage.setItem(WELCOME_KEY, true);
    router.replace("/(tabs)");
  };

  const goTo = (i: number) => {
    Haptics.selectionAsync().catch(() => {});
    scrollRef.current?.scrollTo({ x: i * box.width, animated: true });
    setIndex(i);
  };

  const next = () => {
    if (index >= total - 1) finish();
    else goTo(index + 1);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / box.width);
    if (i !== index) setIndex(i);
  };

  const isLast = index === total - 1;
  const slideStyle = { width: box.width, height: box.height };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        {!isLast ? (
          <Pressable testID="welcome-skip" onPress={finish} hitSlop={12}>
            <Text style={styles.skip}>Saltar</Text>
          </Pressable>
        ) : (
          <View style={{ height: 20 }} />
        )}
      </View>

      <View
        style={styles.flex}
        onLayout={(e) => setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      >
        {box.height > 0 && (
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
          >
            {/* Brand intro slide */}
            <View style={[styles.slide, slideStyle]}>
              <View style={styles.brandBlock}>
                <BrandLogo height={48} />
                <Text style={styles.welcomeHi}>Bienvenido</Text>
                <Text style={styles.tagline}>Gestión profesional de casos de tanatopraxia</Text>
              </View>
            </View>

            {/* Feature slides */}
            {SLIDES.map((s) => (
              <View key={s.key} style={[styles.slide, slideStyle]}>
                <LinearGradient
                  colors={[colors.surfaceTertiary, colors.surfaceSecondary]}
                  style={styles.iconWrap}
                >
                  <Ionicons name={s.icon} size={64} color={colors.onSurface} />
                </LinearGradient>
                <Text style={styles.slideTitle}>{s.title}</Text>
                <Text style={styles.slideDesc}>{s.desc}</Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.dots}>
          {Array.from({ length: total }).map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
        <Button
          testID="welcome-next"
          label={isLast ? "Comenzar" : "Siguiente"}
          icon={isLast ? "arrow-forward" : undefined}
          onPress={next}
          style={{ alignSelf: "stretch" }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  topBar: {
    height: 44,
    justifyContent: "center",
    alignItems: "flex-end",
    paddingHorizontal: spacing.xl,
  },
  skip: { color: colors.onSurfaceTertiary, fontFamily: font.medium, fontSize: fontSize.base },
  slide: { alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  brandBlock: { alignItems: "center", gap: spacing.md },
  welcomeHi: {
    color: colors.onSurface,
    fontFamily: font.bold,
    fontSize: fontSize.xxl,
    marginTop: spacing.xl,
  },
  tagline: {
    color: colors.onSurfaceSecondary,
    fontFamily: font.regular,
    fontSize: fontSize.lg,
    textAlign: "center",
    lineHeight: 24,
  },
  iconWrap: {
    width: 140,
    height: 140,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xxl,
  },
  slideTitle: {
    color: colors.onSurface,
    fontFamily: font.bold,
    fontSize: fontSize.xxl,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  slideDesc: {
    color: colors.onSurfaceSecondary,
    fontFamily: font.regular,
    fontSize: fontSize.lg,
    textAlign: "center",
    lineHeight: 24,
    paddingHorizontal: spacing.md,
  },
  footer: { paddingHorizontal: spacing.xl, gap: spacing.xl },
  dots: { flexDirection: "row", justifyContent: "center", gap: spacing.sm },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceTertiary,
  },
  dotActive: { backgroundColor: colors.onSurface, width: 22 },
});
