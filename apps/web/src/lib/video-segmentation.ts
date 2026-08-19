import type { VideoModelConfig } from "@/lib/video-model-config";

export interface VideoSegmentPlan {
  // Per-segment target durations in generation order, e.g. [8, 6] for a 14s
  // scene on a model with fixedDurations [4, 6, 8].
  durations: number[];
  totalSeconds: number;
}

const MAX_SEGMENTS = 6;

// No config (legacy/unconfigured model) -> today's behavior: one
// unconstrained-length segment.
export function planVideoSegments(targetSeconds: number, config: VideoModelConfig | null): VideoSegmentPlan {
  const target = Math.max(0, targetSeconds);
  if (!config) {
    return { durations: [target], totalSeconds: target };
  }
  if (config.durationMode === "fixed") {
    return planFixedSegments(target, config.fixedDurations ?? []);
  }
  return planRangeSegments(target, config.minDurationSeconds ?? 1, config.maxDurationSeconds ?? (target || 1));
}

function planFixedSegments(targetSeconds: number, steps: number[]): VideoSegmentPlan {
  const options = [...new Set(steps.filter((s) => s > 0))].sort((a, b) => a - b);
  if (options.length === 0) {
    return { durations: [targetSeconds], totalSeconds: targetSeconds };
  }
  if (targetSeconds <= 0) {
    return { durations: [options[0]], totalSeconds: options[0] };
  }

  // Smallest number of steps whose sum is >= targetSeconds, breaking ties by
  // least overshoot. The search space (<= MAX_SEGMENTS steps from a handful
  // of options) is tiny, so plain BFS by segment count is fine.
  let best: number[] | null = null;
  const largest = options[options.length - 1];
  const maxCount = Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(targetSeconds / options[0])));

  function search(count: number) {
    // Try every combination (with repetition) of `count` steps via
    // recursive descent, since count and options.length are both small.
    const combo: number[] = [];
    function recurse(remainingCount: number) {
      if (remainingCount === 0) {
        const sum = combo.reduce((a, b) => a + b, 0);
        if (sum >= targetSeconds) {
          if (!best || sum < best.reduce((a, b) => a + b, 0)) {
            best = [...combo].sort((a, b) => b - a);
          }
        }
        return;
      }
      for (const opt of options) {
        combo.push(opt);
        recurse(remainingCount - 1);
        combo.pop();
      }
    }
    recurse(count);
  }

  for (let count = 1; count <= maxCount; count++) {
    // Quick feasibility check before the combinatorial search.
    if (count * largest < targetSeconds && count < maxCount) continue;
    search(count);
    if (best) break;
  }

  if (!best) {
    // Cap reached without covering the target — use the largest option
    // repeated MAX_SEGMENTS times rather than under-covering the scene.
    best = Array(MAX_SEGMENTS).fill(largest);
  }

  const durations: number[] = best;
  return { durations, totalSeconds: durations.reduce((a, b) => a + b, 0) };
}

function planRangeSegments(targetSeconds: number, min: number, max: number): VideoSegmentPlan {
  if (max <= 0) max = Math.max(min, 1);
  if (targetSeconds <= max) {
    const duration = Math.max(min, targetSeconds || min);
    return { durations: [duration], totalSeconds: duration };
  }
  const segmentCount = Math.min(MAX_SEGMENTS, Math.ceil(targetSeconds / max));
  const even = Math.min(max, Math.max(min, targetSeconds / segmentCount));
  const durations = Array(segmentCount).fill(even);
  return { durations, totalSeconds: durations.reduce((a: number, b: number) => a + b, 0) };
}
