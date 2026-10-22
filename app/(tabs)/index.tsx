import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import WebView from "react-native-webview";

import { ORIGINAL_MOBILE_HTML } from "@/lib/original-mobile-html";

/** The supplied build-mobile is the product source of truth. */
export default function OriginalMiniAppScreen() {
  if (Platform.OS === "web") {
    return (
      <View style={styles.root}>
        {React.createElement("iframe", {
          title: "На двоих",
          src: "/na-dvoih-original/index.html",
          style: iframeStyle,
          allow: "clipboard-read; clipboard-write",
        })}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <WebView
        originWhitelist={["*"]}
        source={{ html: ORIGINAL_MOBILE_HTML }}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        bounces={false}
        showsVerticalScrollIndicator={false}
        style={styles.webView}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fffaf5" },
  webView: { flex: 1, backgroundColor: "transparent" },
});

const iframeStyle = { border: 0, width: "100%", height: "100%", display: "block" } as any;
