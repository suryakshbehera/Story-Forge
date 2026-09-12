export interface SceneVideoClipItem {
  id: string;
  url: string;
  isSelected: boolean;
  batchId?: string | null;
  segmentOrder?: number | null;
  pairIndex?: number | null;
  // Advisory-only auto-QC signal (see checkSegmentFrozen in
  // lib/scene-video.ts) — null means not checked, never a failure.
  qcPassed?: boolean | null;
  qcNotes?: string | null;
  // Per-clip generation details, surfaced in an expandable panel so an
  // off-looking scene can be diagnosed pair-by-pair — see
  // SerializedSceneVideoClip in lib/scene-video.ts.
  modelId?: string | null;
  prompt?: string | null;
  usedEndFrame?: boolean | null;
}

export interface VideoTake {
  key: string;
  clips: SceneVideoClipItem[];
  isSelected: boolean;
}

export function groupIntoTakes(clips: SceneVideoClipItem[]): VideoTake[] {
  const byBatch = new Map<string, SceneVideoClipItem[]>();
  const takes: VideoTake[] = [];
  for (const clip of clips) {
    if (!clip.batchId) {
      takes.push({ key: clip.id, clips: [clip], isSelected: clip.isSelected });
      continue;
    }
    const existing = byBatch.get(clip.batchId);
    if (existing) {
      existing.push(clip);
    } else {
      const group: SceneVideoClipItem[] = [clip];
      byBatch.set(clip.batchId, group);
      takes.push({ key: clip.batchId, clips: group, isSelected: clip.isSelected });
    }
  }
  for (const take of takes) {
    take.clips.sort((a, b) => (a.segmentOrder ?? 0) - (b.segmentOrder ?? 0));
  }
  return takes;
}

// Clips are already sorted by segmentOrder within a take. Consecutive clips
// sharing a pairIndex are duration-chained sub-segments of the same shot
// pair (rare — only when a pair's own target duration exceeds what the
// model can produce in one call), so only the first gets the plain label.
export function clipLabel(clips: SceneVideoClipItem[], i: number): string | undefined {
  if (clips.length <= 1) return undefined;
  const clip = clips[i];
  if (clip.pairIndex == null) return `Segment ${i + 1}`;
  const isContinuation = i > 0 && clips[i - 1].pairIndex === clip.pairIndex;
  const pairLabel = `Shot ${clip.pairIndex + 1}→${clip.pairIndex + 2}`;
  return isContinuation ? `${pairLabel} (cont.)` : pairLabel;
}
