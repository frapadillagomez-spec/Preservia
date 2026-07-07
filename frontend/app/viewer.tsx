import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { colors, font, fontSize, spacing } from "@/src/theme";

const PDF_HTML = (b64: string) => `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=4">
<style>
  html,body{margin:0;padding:0;background:#0F172A;}
  #pages{padding:8px 6px 24px;}
  canvas{width:100%;height:auto;display:block;margin:0 auto 10px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.4);}
  #msg{color:#94A3B8;font-family:-apple-system,Roboto,sans-serif;padding:24px;text-align:center;}
</style>
</head>
<body>
<div id="msg">Cargando documento…</div>
<div id="pages"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
  (function(){
    try {
      var b64 = "${b64}";
      var bin = atob(b64);
      var len = bin.length;
      var bytes = new Uint8Array(len);
      for (var i=0;i<len;i++){ bytes[i]=bin.charCodeAt(i); }
      pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      pdfjsLib.getDocument({data:bytes}).promise.then(function(pdf){
        document.getElementById('msg').style.display='none';
        var container=document.getElementById('pages');
        var scale=(window.devicePixelRatio||1)*1.4;
        function renderPage(n){
          return pdf.getPage(n).then(function(page){
            var vp=page.getViewport({scale:scale});
            var canvas=document.createElement('canvas');
            canvas.width=vp.width; canvas.height=vp.height;
            container.appendChild(canvas);
            return page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
          });
        }
        var chain=Promise.resolve();
        for(var p=1;p<=pdf.numPages;p++){ (function(pg){ chain=chain.then(function(){return renderPage(pg);}); })(p); }
        return chain;
      }).catch(function(){
        document.getElementById('msg').textContent='No se pudo mostrar el PDF.';
      });
    } catch(e){
      document.getElementById('msg').textContent='No se pudo mostrar el PDF.';
    }
  })();
</script>
</body>
</html>`;

export default function Viewer() {
  const insets = useSafeAreaInsets();
  const { scope, id, title } = useLocalSearchParams<{ scope: string; id: string; title: string }>();
  const [b64, setB64] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const endpoint = scope === "catalog" ? "/catalog/documents" : "/library/documents";
        const resp = await api.get<{ document: { pdf_base64: string } }>(`${endpoint}/${id}`);
        setB64(resp.document.pdf_base64);
      } catch {
        setError(true);
      }
    })();
  }, [scope, id]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Pressable testID="viewer-back" onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title || "Documento"}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.body} testID="viewer-body">
        {error ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={40} color={colors.onSurfaceTertiary} />
            <Text style={styles.msg}>No se pudo cargar el documento</Text>
          </View>
        ) : b64 === null ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.onSurfaceSecondary} />
          </View>
        ) : Platform.OS === "web" ? (
          React.createElement("iframe", {
            title: "pdf",
            srcDoc: PDF_HTML(b64),
            style: { border: "none", width: "100%", height: "100%", flex: 1, backgroundColor: colors.surface },
          })
        ) : (
          <WebView
            testID="viewer-webview"
            originWhitelist={["*"]}
            source={{ html: PDF_HTML(b64) }}
            style={{ flex: 1, backgroundColor: colors.surface }}
            javaScriptEnabled
            scalesPageToFit
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onSurface, fontFamily: font.semibold, fontSize: fontSize.lg },
  body: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  msg: { color: colors.onSurfaceSecondary, fontFamily: font.regular, fontSize: fontSize.base },
});
