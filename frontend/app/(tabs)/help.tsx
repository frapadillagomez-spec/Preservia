import { useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { useToast } from "@/src/components/Toast";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";
import { BrandBar } from "@/src/components/BrandLogo";

const SUPPORT_EMAIL = "francisco.padilla@preservia.mx";
const WEBSITE_URL = "https://www.preservia.mx";
const WHATSAPP_NUMBER = "5548708776";
const WHATSAPP_URL = "https://wa.me/52" + WHATSAPP_NUMBER;

const FAQ = [
  {
    q: "¿Mis casos son privados?",
    a: "Sí. Cada profesional accede únicamente a sus propios casos, notas y documentos. Todo se respalda de forma segura en la nube y va ligado a tu cuenta.",
  },
  {
    q: "¿Cómo genero un reporte PDF?",
    a: "Abre un caso, ve a la pestaña 'Reporte' y toca 'Generar y compartir PDF'. El documento incluye los datos del caso, los cálculos y las notas con sus fotos.",
  },
  {
    q: "¿Las fórmulas son estándar?",
    a: "Usamos fórmulas de referencia del sector (volumen por peso, masa magra de Boer y dilución C₁V₁=C₂V₂). Encontrarás la explicación completa en la Biblioteca.",
  },
  {
    q: "¿Puedo usar la app sin conexión?",
    a: "En esta versión se requiere conexión a internet para sincronizar y respaldar tus casos. El modo offline está previsto para una próxima actualización.",
  },
  {
    q: "¿Qué documentos puedo subir a la Biblioteca?",
    a: "Puedes subir tus propias guías o protocolos en formato PDF, además de consultar el contenido técnico de referencia incluido en la app.",
  },
];

const STEPS = [
  { icon: "log-in-outline", text: "Inicia sesión con tu correo o con Google." },
  { icon: "add-circle-outline", text: "Crea un caso con su nombre y referencia." },
  { icon: "calculator-outline", text: "Realiza cálculos y guárdalos en el caso." },
  { icon: "document-text-outline", text: "Agrega notas con texto y fotos." },
  { icon: "download-outline", text: "Genera el reporte PDF y compártelo." },
] as const;

export default function Help() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [open, setOpen] = useState<number | null>(0);

  const toggle = (i: number) => {
    Haptics.selectionAsync().catch(() => {});
    setOpen((cur) => (cur === i ? null : i));
  };

  const contactSupport = async () => {
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Soporte Preservia")}`;
    try {
      const ok = await Linking.canOpenURL(url);
      if (ok || Platform.OS === "web") {
        await Linking.openURL(url);
      } else {
        toast.show(`Escríbenos a ${SUPPORT_EMAIL}`, "info");
      }
    } catch {
      toast.show(`Escríbenos a ${SUPPORT_EMAIL}`, "info");
    }
  };

  const openLink = async (url: string, fallback: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      toast.show(fallback, "info");
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <BrandBar />
      <View style={styles.header}>
        <Text style={styles.title}>Ayuda</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>Guía rápida de uso</Text>
        <View style={styles.guideCard}>
          {STEPS.map((s, i) => (
            <View key={i} style={styles.step}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <Ionicons name={s.icon} size={18} color={colors.onSurfaceSecondary} />
              <Text style={styles.stepText}>{s.text}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Preguntas frecuentes</Text>
        {FAQ.map((item, i) => (
          <Pressable
            key={i}
            testID={`faq-${i}`}
            onPress={() => toggle(i)}
            style={styles.faqCard}
          >
            <View style={styles.faqHeader}>
              <Text style={styles.faqQ}>{item.q}</Text>
              <Ionicons
                name={open === i ? "chevron-up" : "chevron-down"}
                size={18}
                color={colors.onSurfaceTertiary}
              />
            </View>
            {open === i && <Text style={styles.faqA}>{item.a}</Text>}
          </Pressable>
        ))}

        <Text style={styles.sectionLabel}>Contacto de soporte</Text>
        <Pressable testID="contact-support-button" onPress={contactSupport} style={styles.supportCard}>
          <View style={styles.supportIcon}>
            <Ionicons name="mail-outline" size={22} color={colors.info} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.supportTitle}>Escríbenos</Text>
            <Text style={styles.supportSub}>{SUPPORT_EMAIL}</Text>
          </View>
          <Ionicons name="open-outline" size={20} color={colors.onSurfaceTertiary} />
        </Pressable>

        <Pressable
          testID="contact-whatsapp-button"
          onPress={() => openLink(WHATSAPP_URL, `WhatsApp: ${WHATSAPP_NUMBER}`)}
          style={[styles.supportCard, { marginTop: spacing.sm }]}
        >
          <View style={[styles.supportIcon, { backgroundColor: colors.successBg }]}>
            <Ionicons name="logo-whatsapp" size={22} color={colors.success} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.supportTitle}>WhatsApp</Text>
            <Text style={styles.supportSub}>55 4870 8776</Text>
          </View>
          <Ionicons name="open-outline" size={20} color={colors.onSurfaceTertiary} />
        </Pressable>

        <Pressable
          testID="website-button"
          onPress={() => openLink(WEBSITE_URL, "www.preservia.mx")}
          style={[styles.supportCard, { marginTop: spacing.sm }]}
        >
          <View style={[styles.supportIcon, { backgroundColor: colors.brandTertiary }]}>
            <Ionicons name="globe-outline" size={22} color={colors.onSurface} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.supportTitle}>Sitio web</Text>
            <Text style={styles.supportSub}>www.preservia.mx</Text>
          </View>
          <Ionicons name="open-outline" size={20} color={colors.onSurfaceTertiary} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.bold, fontSize: fontSize.xxxl },
  scroll: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxxl },
  sectionLabel: {
    color: colors.onSurfaceTertiary,
    fontFamily: font.medium,
    fontSize: fontSize.sm,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  guideCard: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  step: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumText: { color: colors.onSurfaceSecondary, fontFamily: font.monoSemibold, fontSize: fontSize.sm },
  stepText: { flex: 1, color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: fontSize.base },
  faqCard: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  faqHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  faqQ: { flex: 1, color: colors.onSurface, fontFamily: font.medium, fontSize: fontSize.base },
  faqA: {
    color: colors.onSurfaceSecondary,
    fontFamily: font.regular,
    fontSize: fontSize.base,
    lineHeight: 21,
    marginTop: spacing.md,
  },
  supportCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  supportIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.infoBg,
    alignItems: "center",
    justifyContent: "center",
  },
  supportTitle: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.lg },
  supportSub: { color: colors.onSurfaceTertiary, fontFamily: font.mono, fontSize: fontSize.sm, marginTop: 2 },
});
