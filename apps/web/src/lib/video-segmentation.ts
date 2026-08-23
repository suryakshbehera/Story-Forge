import type { VideoModelConfig } from "@/lib/video-model-config";

export interface VideoSegmentPlan {
  // Per-segment target durations in generation order, e.g. [8, 6] for a 14s
  // scene on a model with fixedDurations [4, 6, 8].
  durations: number[];
  totalSeconds: number;
}

const MAX_SEGMENTS = 6;

// No config (legacy/unconfigured model) -> today's behavior: one
// unconstrained-length segment. Rounded regardless — targetSeconds is often
// a real ffprobe'd duration (getSceneVoiceDurationSeconds), and OpenRouter's
// video endpoint requires an integer `duration`; fixed-mode's own options
// are always whole numbers already, but the unconfigured and range paths
// need rounding explicitly, done once here so every caller gets it for free.
export function planVideoSegments(targetSeconds: number, config: VideoModelConfig | null): VideoSegmentPlan {
  const target = Math.max(0, targetSeconds);
  if (!config) {
    const rounded = Math.max(1, Math.round(target));
    return { durations: [rounded], totalSeconds: rounded };
  }
  if (config.durationMode === "fixed") {
    return planFixedSegments(target, config.fixedDurations ?? []);
  }
  return planRangeSegments(target, config.minDurationSeconds ?? 1, config.maxDurationSeconds ?? (target || 1));
}

function planFixedSegments(targetSeconds: number, steps: number[]): VideoSegmentPlan {
  const options = [...new Set(steps.filter((s) => s > 0))].sort((a, b) => a - b);
  if (options.length === 0) {
    const rounded = Math.max(1, Math.round(targetSeconds));
    return { durations: [rounded], totalSeconds: rounded };
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

// Distributes a scene's total target duration across exactly `legCount` legs
// (one per shot pair, for IMAGE_TO_VIDEO's per-pair generation), each leg
// snapped to one of a fixed-duration model's valid clip lengths, choosing
// whichever combination's sum lands closest to targetSeconds — rather than
// dividing evenly and letting each leg round up independently, which
// overshoots more than necessary (e.g. 14s over 2 legs on [4,6,8]s options:
// naive 7+7 rounds to 8+8=16s; this returns 8+6=14s exactly). Falls back to
// a plain even split when there's no fixed-duration config (an unconstrained
// or range-mode model already gets sensible per-leg clamping from
// planVideoSegments itself, called separately per leg after this).
export function splitFixedDurations(targetSeconds: number, legCount: number, options: number[]): number[] {
  const legs = Math.max(legCount, 0);
  const opts = [...new Set(options.filter((o) => o > 0))].sort((a, b) => a - b);
  if (legs === 0) return [];
  if (opts.length === 0) return Array(legs).fill(Math.max(1, Math.round(Math.max(targetSeconds, 0) / legs)));

  // sumsAtStep[k] = every sum reachable using exactly k legs from `opts`.
  // Small in practice (a handful of fixed durations, a modest leg count from
  // shot count), so tracking every reachable sum per step is cheap — no need
  // for combinatorial enumeration of full combos until reconstruction below.
  const sumsAtStep: Set<number>[] = [new Set([0])];
  for (let k = 1; k <= legs; k++) {
    const prev = sumsAtStep[k - 1];
    const cur = new Set<number>();
    for (const s of prev) {
      for (const opt of opts) cur.add(s + opt);
    }
    sumsAtStep.push(cur);
  }

  let bestSum = opts[0] * legs;
  let bestDiff = Infinity;
  for (const s of sumsAtStep[legs]) {
    const diff = Math.abs(s - targetSeconds);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestSum = s;
    }
  }

  // Reconstruct one combination achieving bestSum in `legs` legs by walking
  // the per-step reachable-sum sets backward.
  const result: number[] = [];
  let remaining = bestSum;
  for (let k = legs; k >= 1; k--) {
    const prevSums = sumsAtStep[k - 1];
    for (const opt of opts) {
      if (prevSums.has(remaining - opt)) {
        result.push(opt);
        remaining -= opt;
        break;
      }
    }
  }
  return result.sort((a, b) => b - a);
}

function planRangeSegments(targetSeconds: number, min: number, max: number): VideoSegmentPlan {
  if (max <= 0) max = Math.max(min, 1);
  if (targetSeconds <= max) {
    // Round after clamping, then re-clamp — rounding a value already at the
    // min/max boundary (e.g. 3.6 rounding up past a max of 4) must not push
    // it back out of range.
    const duration = Math.min(max, Math.max(min, Math.round(Math.max(min, targetSeconds || min))));
    return { durations: [duration], totalSeconds: duration };
  }
  const segmentCount = Math.min(MAX_SEGMENTS, Math.ceil(targetSeconds / max));
  const even = Math.min(max, Math.max(min, Math.round(targetSeconds / segmentCount)));
  const durations = Array(segmentCount).fill(even);
  return { durations, totalSeconds: durations.reduce((a: number, b: number) => a + b, 0) };
}
