import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";

import { useAuth } from "@/src/context/AuthContext";
import { colors } from "@/src/theme";

export default function Index() {
  const { user, loading, googleBusy } = useAuth();

  if (loading || googleBusy) {
    return (
      <View
        testID="boot-loading"
        style={{ flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}
      >
        <ActivityIndicator size="large" color={colors.onSurfaceSecondary} />
      </View>
    );
  }

  return <Redirect href={user ? "/(tabs)" : "/login"} />;
}
