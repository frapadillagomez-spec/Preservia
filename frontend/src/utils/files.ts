import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";

/** Guarda/comparte un archivo JSON (descarga en web, hoja de compartir en el teléfono). */
export async function saveJsonFile(filename: string, json: string) {
  if (Platform.OS === "web") {
    const blob = new Blob([json], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    return;
  }
  const uri = FileSystem.cacheDirectory + filename;
  await FileSystem.writeAsStringAsync(uri, json);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/json", UTI: "public.json" });
  }
}

/** Abre el selector de archivos y devuelve el JSON leído (o null si se cancela). */
export async function pickJsonFile(): Promise<any | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: "application/json", copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.[0]) return null;
  const uri = res.assets[0].uri;
  const text = Platform.OS === "web" ? await (await fetch(uri)).text() : await FileSystem.readAsStringAsync(uri);
  return JSON.parse(text);
}
