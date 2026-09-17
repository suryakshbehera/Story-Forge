import { useEffect } from "react";
import { StyleSheet, Pressable } from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { SymbolView } from "expo-symbols";

import { Text, View, useThemeColors } from "@/components/Themed";

/**
 * Full-bleed media for the current take — region B of the review card
 * (mobile-app-ux-plan §4.2). `displayUrl` overrides the take's own media for
 * long-press/Compare (swaps to the selected take or shot N-1's continuity
 * reference while held); only ever used for images, since compare is a
 * still-frame judgement (see the review-queue's own compare:null for every
 * non-image kind).
 *
 * Multi-clip video takes (kind:"video") play only their first clip for now
 * — full sequential playlist playback across clips is real scope beyond
 * this pass, not a placeholder oversight.
 */
export function TakeMedia({
  media,
  url,
  displayUrl,
  clipCount,
}: {
  media: "image" | "video" | "audio";
  url: string;
  displayUrl?: string;
  clipCount?: number;
}) {
  const colors = useThemeColors();
  const shownUrl = displayUrl ?? url;

  if (media === "image") {
    return <Image source={{ uri: shownUrl }} style={styles.fill} contentFit="contain" transition={100} />;
  }

  if (media === "video") {
    return (
      <View style={styles.fill}>
        <VideoTake url={shownUrl} />
        {clipCount != null && clipCount > 1 && (
          <View style={[styles.clipBadge, { backgroundColor: colors.background }]}>
            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Clip 1 of {clipCount}</Text>
          </View>
        )}
      </View>
    );
  }

  return <AudioTake url={shownUrl} />;
}

function VideoTake({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.play();
  });
  useEffect(() => () => player.release(), [player]);
  return <VideoView player={player} style={styles.fill} contentFit="contain" nativeControls />;
}

function AudioTake({ url }: { url: string }) {
  const colors = useThemeColors();
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);

  useEffect(() => () => player.release(), [player]);

  function toggle() {
    if (status.playing) player.pause();
    else player.play();
  }

  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;

  return (
    <View style={styles.audioContainer}>
      <Pressable
        onPress={toggle}
        style={[styles.playButton, { backgroundColor: colors.secondary }]}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? "Pause" : "Play"}
      >
        <SymbolView
          name={{ ios: status.playing ? "pause.fill" : "play.fill", android: status.playing ? "pause" : "play_arrow", web: status.playing ? "pause" : "play_arrow" }}
          tintColor={colors.foreground}
          size={32}
        />
      </Pressable>
      <View style={[styles.progressTrack, { backgroundColor: colors.secondary }]}>
        <View style={[styles.progressFill, { backgroundColor: colors.foreground, width: `${Math.min(100, progress * 100)}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, width: "100%" },
  clipBadge: { position: "absolute", top: 12, right: 12, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  audioContainer: { flex: 1, width: "100%", justifyContent: "center", alignItems: "center", gap: 20, paddingHorizontal: 32 },
  playButton: { width: 64, height: 64, borderRadius: 32, justifyContent: "center", alignItems: "center" },
  progressTrack: { width: "100%", height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%" },
});
