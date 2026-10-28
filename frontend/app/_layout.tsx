import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { useAppFonts } from "@/src/hooks/use-app-fonts";
import { AuthProvider } from "@/src/context/AuthContext";
import { ToastProvider } from "@/src/components/Toast";
import { SyncLayout } from "@/src/components/SyncCenter";
import { LockGate } from "@/src/components/LockGate";
import { colors } from "@/src/theme";

// Disable logbox errors so users can see the app.
LogBox.ignoreAllLogs(true);

// Keep the native splash visible from cold start until icon fonts register
// (avoids icons rendering before the Ionicons family is available in Expo Go).
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [iconsLoaded, iconsError] = useIconFonts();
  const [fontsLoaded, fontsError] = useAppFonts();

  const ready = (iconsLoaded || iconsError) && (fontsLoaded || fontsError);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  // If the CDN is unreachable we fall through on error rather than wedging
  // the app — icons will tofu, but the app still boots.
  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <AuthProvider>
            <ToastProvider>
              <View style={{ flex: 1, backgroundColor: colors.surface }}>
                <StatusBar style="dark" />
                <SyncLayout>
                <LockGate>
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
                  <Stack.Screen name="index" />
                  <Stack.Screen name="welcome" />
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="case/new" options={{ presentation: "modal" }} />
                  <Stack.Screen name="case/[id]" />
                  <Stack.Screen name="library/[id]" />
                  <Stack.Screen name="calculator/[type]" options={{ presentation: "modal" }} />
                  <Stack.Screen name="calculator/wizard" options={{ presentation: "modal" }} />
                  <Stack.Screen name="viewer" />
                </Stack>
                </LockGate>
                </SyncLayout>
              </View>
            </ToastProvider>
          </AuthProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
