import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import type { ComponentProps } from "react";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { api } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

const TARGETS: { key: string; label: string; icon: IconName; hint: string }[] = [
  { key: "onedrive", label: "OneDrive", icon: "logo-microsoft", hint: "Elige OneDrive en el menú" },
  { key: "gdrive", label: "Google Drive", icon: "logo-google", hint: "Elige Drive en el menú" },
  { key: "icloud", label: "iCloud", icon: "logo-apple", hint: "Elige “Guardar en Archivos” → iCloud Drive" },
  { key: "dropbox", label: "Dropbox", icon: "logo-dropbox", hint: "Elige Dropbox en el menú" },
  { key: "whatsapp", label: "WhatsApp", icon: "logo-whatsapp", hint: "Elige WhatsApp y el contacto" },
];

/** Botones para subir el reporte PDF a la nube o enviarlo por WhatsApp (menú de compartir del teléfono). */
export function ReportShare({ caseId }: { caseId: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const send = async (t: (typeof TARGETS)[number]) => {
    setBusy(t.key);
    try {
      const resp = await api.get<{ filename: string; pdf_base64: string }>(`/cases/${caseId}/report`);
      const filename = resp.filename || "Reporte.pdf";
      if (Platform.OS === "web") {
        const link = document.createElement("a");
        link.href = `data:application/pdf;base64,${resp.pdf_base64}`;
        link.download = filename;
        link.click();
        toast.show(`Reporte descargado. Súbelo a ${t.label} desde tu navegador.`, "success");
        return;
      }
      const uri = FileSystem.cacheDirectory + filename;
      await FileSystem.writeAsStringAsync(uri, resp.pdf_base64, { encoding: FileSystem.EncodingType.Base64 });
      if (!(await Sharing.isAvailableAsync())) {
        toast.show("Este dispositivo no permite compartir archivos", "error");
        return;
      }
      toast.show(t.hint, "info");
      await Sharing.shareAsync(uri, {
        mimeType: "application/pdf",
        UTI: "com.adobe.pdf",
        dialogTitle: t.key === "whatsapp" ? "Enviar reporte por WhatsApp" : `Subir reporte a ${t.label}`,
      });
    } catch (e: any) {
      toast.show(
        e?.status === 0 ? "Sin conexión: el reporte necesita internet para generarse" : e?.detail || "No se pudo preparar el reporte",
        "error",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <View testID="report-share" style={styles.box}>
      <Text style={styles.title}>Subir o enviar el reporte</Text>
      <Text style={styles.sub}>Necesitas tener la app del servicio instalada en tu teléfono.</Text>
      <View style={styles.grid}>
        {TARGETS.map((t) => (
          <Pressable
            key={t.key}
            testID={`share-${t.key}`}
            onPress={() => send(t)}
            disabled={!!busy}
            style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}
          >
            {busy === t.key ? (
              <ActivityIndicator size="small" color={colors.onSurface} />
            ) : (
              <Ionicons name={t.icon} size={22} color={colors.onSurface} />
            )}
            <Text style={styles.btnText}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: "stretch", marginTop: spacing.lg },
  title: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base },
  sub: { color: colors.onSurfaceTertiary, fontFamily: font.regular, fontSize: fontSize.sm, marginTop: 2, marginBottom: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  btn: {
    flexGrow: 1,
    flexBasis: "45%",
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  btnText: { color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.base },
});
