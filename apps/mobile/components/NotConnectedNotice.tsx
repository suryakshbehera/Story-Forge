import { StyleSheet } from 'react-native';

import { Text, View, useThemeColors } from '@/components/Themed';

/**
 * M0.3 ships the shell before the backend can answer it — the read API
 * (plan §10 ask 1) and mobile auth (§10 ask 2) are still being decided by
 * technical-architect. Every screen says so plainly instead of showing
 * fabricated data, per the plan's own honesty-note convention.
 */
export function NotConnectedNotice({ detail }: { detail: string }) {
  const colors = useThemeColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.foreground }]}>Not connected yet</Text>
      <Text style={[styles.detail, { color: colors.mutedForeground }]}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 20,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  detail: {
    fontSize: 13,
    lineHeight: 18,
  },
});
