import { memo, useMemo, type ReactNode } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from "react-native";

import { Fonts, Radius, Spacing, type Theme } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  parseAssistantMarkdown,
  safeMarkdownLink,
  type InlineText,
  type MarkdownBlock,
} from "@/lib/assistant/markdown";

function openLink(href: string) {
  const safe = safeMarkdownLink(href);
  if (!safe) return;
  void Linking.openURL(safe).catch(() =>
    Alert.alert("Link unavailable", "This link could not be opened. Please try again."),
  );
}

function Inline({
  nodes,
  theme,
  streaming,
}: {
  nodes: InlineText[];
  theme: Theme;
  streaming: boolean;
}): ReactNode {
  return nodes.map((node, index) => {
    if (node.kind === "text") return node.text;
    if (node.kind === "code") {
      return (
        <Text key={index} style={[styles.inlineCode, { backgroundColor: theme.field }]}>
          {node.text}
        </Text>
      );
    }
    const children = <Inline nodes={node.children} theme={theme} streaming={streaming} />;
    if (node.kind === "link") {
      // Do not make a destination actionable until the reply has finished streaming.
      if (!node.href || streaming) return <Text key={index}>{children}</Text>;
      const href = node.href;
      return (
        <Text
          key={index}
          accessibilityRole="link"
          accessibilityHint={`Opens ${new URL(href).hostname} in your browser`}
          onPress={() => openLink(href)}
          style={[styles.link, { color: theme.accent }]}
        >
          {children}
        </Text>
      );
    }
    return (
      <Text
        key={index}
        style={
          node.kind === "strong"
            ? styles.strong
            : node.kind === "emphasis"
              ? styles.emphasis
              : styles.strike
        }
      >
        {children}
      </Text>
    );
  });
}

function Blocks({
  nodes,
  theme,
  streaming,
  compact = false,
}: {
  nodes: MarkdownBlock[];
  theme: Theme;
  streaming: boolean;
  compact?: boolean;
}) {
  const body = [styles.body, { color: theme.text }];
  return (
    <View style={[styles.blocks, compact && styles.compact]}>
      {nodes.map((node, index) => {
        switch (node.kind) {
          case "paragraph":
            return (
              <Text key={index} selectable style={body}>
                <Inline nodes={node.children} theme={theme} streaming={streaming} />
              </Text>
            );
          case "heading":
            return (
              <Text
                key={index}
                selectable
                accessibilityRole="header"
                style={[
                  body,
                  styles.heading,
                  node.level > 2 && styles.subheading,
                  index > 0 && styles.headingAfter,
                ]}
              >
                <Inline nodes={node.children} theme={theme} streaming={streaming} />
              </Text>
            );
          case "quote":
            return (
              <View
                key={index}
                style={[
                  styles.quote,
                  { borderColor: theme.accent, backgroundColor: theme.accentSoft },
                ]}
              >
                <Blocks nodes={node.children} theme={theme} streaming={streaming} compact />
              </View>
            );
          case "list":
            return (
              <View key={index} style={styles.list}>
                {node.items.map((item, itemIndex) => (
                  <View key={itemIndex} style={styles.listItem}>
                    <Text
                      accessibilityLabel={
                        item.marker === "☑"
                          ? "Checked"
                          : item.marker === "☐"
                            ? "Not checked"
                            : item.marker === "•"
                              ? "Bullet"
                              : undefined
                      }
                      style={[body, styles.marker, { color: theme.textSecondary }]}
                    >
                      {item.marker}
                    </Text>
                    <View style={styles.listContent}>
                      <Blocks nodes={item.children} theme={theme} streaming={streaming} compact />
                    </View>
                  </View>
                ))}
              </View>
            );
          case "code":
            return (
              <ScrollView
                key={index}
                horizontal
                showsHorizontalScrollIndicator
                style={[styles.codeBlock, { backgroundColor: theme.field }]}
                contentContainerStyle={styles.codeContent}
              >
                <Text selectable style={[body, styles.code]}>
                  {node.text}
                </Text>
              </ScrollView>
            );
          case "rule":
            return <View key={index} style={[styles.rule, { backgroundColor: theme.border }]} />;
          case "table":
            return (
              <ScrollView
                key={index}
                horizontal
                showsHorizontalScrollIndicator
                style={[styles.table, { borderColor: theme.border }]}
              >
                <View>
                  {[node.header, ...node.rows].map((row, rowIndex) => (
                    <View
                      key={rowIndex}
                      style={[styles.tableRow, rowIndex === 0 && { backgroundColor: theme.field }]}
                    >
                      {row.map((cell, cellIndex) => (
                        <Text
                          key={cellIndex}
                          selectable
                          style={[
                            body,
                            styles.cell,
                            { borderColor: theme.border },
                            rowIndex === 0 && styles.strong,
                          ]}
                        >
                          <Inline nodes={cell} theme={theme} streaming={streaming} />
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            );
        }
      })}
    </View>
  );
}

/** Native, theme-aware prose. No HTML, WebView, image loading, or generated content. */
export const AssistantMarkdown = memo(function AssistantMarkdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  const theme = useTheme();
  const nodes = useMemo(() => parseAssistantMarkdown(text), [text]);
  return <Blocks nodes={nodes} theme={theme} streaming={streaming} />;
});

const styles = StyleSheet.create({
  blocks: { gap: Spacing.two, minWidth: 0 },
  compact: { gap: Spacing.one },
  body: { fontFamily: Fonts.regular, fontSize: 16, lineHeight: 25, flexShrink: 1 },
  strong: { fontFamily: Fonts.semibold },
  emphasis: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through" },
  heading: { fontFamily: Fonts.semibold, fontSize: 19, lineHeight: 26, letterSpacing: -0.25 },
  subheading: { fontSize: 17, lineHeight: 24 },
  headingAfter: { marginTop: Spacing.half },
  list: { gap: Spacing.one },
  listItem: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.one },
  marker: {
    minWidth: 20,
    textAlign: "right",
    fontFamily: Fonts.medium,
    fontVariant: ["tabular-nums"],
    flexShrink: 0,
  },
  listContent: { flex: 1, minWidth: 0 },
  quote: {
    borderLeftWidth: 2,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderTopRightRadius: Radius.sm,
    borderBottomRightRadius: Radius.sm,
  },
  link: { textDecorationLine: "underline" },
  inlineCode: { fontFamily: Fonts.mono, fontSize: 14 },
  code: { fontFamily: Fonts.mono, fontSize: 13, lineHeight: 21 },
  codeBlock: { borderRadius: Radius.sm },
  codeContent: { padding: Spacing.two },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.half },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.sm },
  tableRow: { flexDirection: "row" },
  cell: {
    width: 144,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 14,
    lineHeight: 21,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
