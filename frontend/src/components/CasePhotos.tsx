import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@react-native-vector-icons/ionicons";

import { api } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Photo = { att_id: string; stage: "antes" | "despues"; created_at: string };
type Stage = "antes" | "despues";

/** Fotos antes / después del caso (se agregan ordenadas al reporte PDF). */
export function CasePhotos({ caseId }: { caseId: string }) {
  const toast = useToast();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Stage | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ attachments: any[] }>(`/cases/${caseId}/attachments`);
      const list: Photo[] = (r.attachments || []).filter((a) => a.kind === "photo");
      setPhotos(list);
      for (const p of list) {
        if (thumbs[p.att_id]) continue;
        api
          .get<{ attachment: { data_base64: string } }>(`/attachments/${p.att_id}`)
          .then((a) => setThumbs((t) => ({ ...t, [p.att_id]: `data:image/jpeg;base64,${a.attachment.data_base64}` })))
          .catch(() => {});
      }
    } catch {
      /* sin conexión: se muestran las ya cargadas */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  const ensure = async (kind: "camera" | "media") => {
    const get = kind === "camera" ? ImagePicker.getCameraPermissionsAsync : ImagePicker.getMediaLibraryPermissionsAsync;
    const req = kind === "camera" ? ImagePicker.requestCameraPermissionsAsync : ImagePicker.requestMediaLibraryPermissionsAsync;
    if ((await get()).granted) return true;
    const res = await req();
    if (res.granted) return true;
    if (!res.canAskAgain) {
      Alert.alert(kind === "camera" ? "Permiso de cámara" : "Permiso de galería", "Habilítalo en Ajustes para agregar fotos del caso.", [
        { text: "Cancelar", style: "cancel" },
        { text: "Abrir Ajustes", onPress: () => Linking.openSettings() },
      ]);
    } else toast.show(kind === "camera" ? "Permiso de cámara denegado" : "Permiso de galería denegado", "error");
    return false;
  };

  const add = async (stage: Stage, source: "camera" | "media") => {
    if (!(await ensure(source))) return;
    const res =
      source === "camera"
        ? await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.5, base64: true, allowsMultipleSelection: true });
    if (res.canceled) return;
    setBusy(stage);
    try {
      for (const a of res.assets) {
        if (!a.base64) continue;
        await api.post(`/cases/${caseId}/attachments`, { label: "Foto", kind: "photo", stage, filename: a.fileName || "foto.jpg", data_base64: a.base64 });
      }
      toast.show("Foto agregada", "success");
      load();
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo agregar la foto", "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (attId: string) => {
    try {
      await api.del(`/attachments/${attId}`);
      setPhotos((p) => p.filter((x) => x.att_id !== attId));
    } catch (e: any) {
      toast.show(e?.detail || "No se pudo eliminar la foto", "error");
    }
  };

  return (
    <View testID="case-photos">
      {(["antes", "despues"] as Stage[]).map((stage) => {
        const list = photos.filter((p) => p.stage === stage);
        return (
          <View key={stage} style={styles.group}>
            <Text style={styles.groupTitle}>{stage === "antes" ? "Antes" : "Después"} ({list.length})</Text>
            <View style={styles.grid}>
              {list.map((p, i) => (
                <View key={p.att_id} testID={`photo-${stage}-${i}`} style={styles.thumb}>
                  {thumbs[p.att_id] ? (
                    <Image source={{ uri: thumbs[p.att_id] }} style={styles.img} contentFit="cover" />
                  ) : (
                    <ActivityIndicator color={colors.onSurfaceTertiary} />
                  )}
                  <Text style={styles.num}>{i + 1}</Text>
                  <Pressable testID={`photo-remove-${stage}-${i}`} onPress={() => remove(p.att_id)} hitSlop={8} style={styles.del}>
                    <Ionicons name="close" size={16} color={colors.onSurfaceInverse} />
                  </Pressable>
                </View>
              ))}
            </View>
            <View style={styles.actions}>
              <Pressable testID={`photo-camera-${stage}`} onPress={() => add(stage, "camera")} style={styles.btn} disabled={!!busy}>
                {busy === stage ? <ActivityIndicator color={colors.onSurface} /> : <Ionicons name="camera-outline" size={18} color={colors.onSurface} />}
                <Text style={styles.btnText}>Tomar foto</Text>
              </Pressable>
              <Pressable testID={`photo-gallery-${stage}`} onPress={() => add(stage, "media")} style={styles.btn} disabled={!!busy}>
                <Ionicons name="images-outline" size={18} color={colors.onSurface} />
                <Text style={styles.btnText}>Galería</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: spacing.md },
  groupTitle: { color: colors.onSurfaceSecondary, fontFamily: font.semibold, fontSize: fontSize.base, marginBottom: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  thumb: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  img: { width: "100%", height: "100%" },
  num: { position: "absolute", left: 6, bottom: 4, color: colors.onSurfaceInverse, fontFamily: font.bold, fontSize: fontSize.sm, textShadowColor: "#000", textShadowRadius: 3 },
  del: { position: "absolute", right: 4, top: 4, width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", gap: spacing.sm },
  btn: { flex: 1, flexDirection: "row", gap: spacing.sm, alignItems: "center", justifyContent: "center", minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  btnText: { color: colors.onSurface, fontFamily: font.medium, fontSize: fontSize.sm },
});
