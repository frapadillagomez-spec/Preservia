import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";

import { storage } from "@/src/utils/storage";
import { colors } from "@/src/theme";

const WELCOME_KEY = "preservia_seen_welcome";

export default function Index() {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const seen = await storage.getItem<boolean>(WELCOME_KEY, false);
      setTarget(seen ? "/(tabs)" : "/welcome");
    })();
  }, []);

  if (!target) {
    return (
      <View
        testID="boot-loading"
        style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}
      >
        <ActivityIndicator size="large" color={colors.onSurfaceSecondary} />
      </View>
    );
  }

  return <Redirect href={target as any} />;
}
