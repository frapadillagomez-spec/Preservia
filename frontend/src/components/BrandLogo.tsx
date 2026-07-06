import { Image } from "expo-image";
import { StyleSheet, View, ViewStyle } from "react-native";

import { spacing } from "@/src/theme";

const LOGO = require("../../assets/images/preservia-logo.webp");

// Preservia wordmark (aspect ratio ~6:1). Pass height; width auto-scales.
export function BrandLogo({ height = 26, style }: { height?: number; style?: ViewStyle }) {
  return (
    <Image
      source={LOGO}
      style={[{ height, aspectRatio: 6, width: height * 6 }, style]}
      contentFit="contain"
      testID="preservia-logo"
    />
  );
}

// Top brand bar used as a header on the main tab screens.
export function BrandBar({ height = 24 }: { height?: number }) {
  return (
    <View style={styles.bar}>
      <BrandLogo height={height} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
  },
});
