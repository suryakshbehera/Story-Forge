import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Local rendering only — mirrors OpenRouterError's role for the hosted AI
// primitives, so routes can catch this one class and map it to a clear
// response regardless of which ffmpeg step failed.
export class FfmpegError extends Error {}

const MAX_BUFFER = 1024 * 1024 * 1024; // 1GB — final renders can be large.

function isMissingBinaryError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}

export async function runFfmpeg(args: string[]): Promise<void> {
  try {
    await execFileAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], {
      maxBuffer: MAX_BUFFER,
    });
  } catch (error) {
    if (isMissingBinaryError(error)) {
      throw new FfmpegError(
        "ffmpeg isn't installed or isn't on PATH. Install ffmpeg and confirm `ffmpeg -version` works, then try again."
      );
    }
    const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr: unknown }).stderr) : "";
    throw new FfmpegError(`ffmpeg failed: ${stderr || (error instanceof Error ? error.message : String(error))}`);
  }
}

export async function hasAudioStream(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", filePath],
      { maxBuffer: MAX_BUFFER }
    );
    return stdout.trim().length > 0;
  } catch (error) {
    if (isMissingBinaryError(error)) {
      throw new FfmpegError(
        "ffprobe isn't installed or isn't on PATH. It normally ships alongside ffmpeg — reinstall ffmpeg and confirm `ffprobe -version` works."
      );
    }
    throw new FfmpegError(`ffprobe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Grabs a generated clip's final frame as a PNG — used to seed the next
// segment's first_frame in frame-chained multi-segment video generation
// (see generateSceneVideo in scene-video.ts), so the sequence continues
// visually instead of resetting to the scene's original starting image.
export async function extractLastFrame(videoPath: string, outPath: string): Promise<void> {
  await runFfmpeg(["-sseof", "-1", "-i", videoPath, "-update", "1", "-frames:v", "1", outPath]);
}

// Total seconds ffmpeg's freezedetect filter reports as frozen/near-static —
// used as an advisory auto-QC signal for generated video clips (see
// checkSegmentFrozen in scene-video.ts): a common image-to-video failure
// mode is the model returning essentially the starting image with no real
// motion. `-f null -` runs the filter without writing output; freezedetect
// logs its findings as plain info-level lines on stderr (not machine-readable
// JSON), so they're parsed out of the raw text. Not run through runFfmpeg
// above because that helper forces `-loglevel error`, which would suppress
// freezedetect's own info-level log lines entirely.
export async function detectFrozenSeconds(filePath: string): Promise<number> {
  try {
    const { stderr } = await execFileAsync(
      "ffmpeg",
      ["-hide_banner", "-i", filePath, "-vf", "freezedetect=n=-60dB:d=0.5", "-map", "0:v:0", "-f", "null", "-"],
      { maxBuffer: MAX_BUFFER }
    );
    return sumFreezeDurations(stderr);
  } catch (error) {
    if (isMissingBinaryError(error)) {
      throw new FfmpegError(
        "ffmpeg isn't installed or isn't on PATH. Install ffmpeg and confirm `ffmpeg -version` works, then try again."
      );
    }
    throw new FfmpegError(
      `ffmpeg freeze detection failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function sumFreezeDurations(stderr: string): number {
  const durations = [...stderr.matchAll(/freeze_duration:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  return durations.reduce((sum, d) => sum + d, 0);
}

export async function probeDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
      { maxBuffer: MAX_BUFFER }
    );
    const seconds = Number(stdout.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new FfmpegError(`ffprobe returned an invalid duration for ${filePath}: "${stdout.trim()}"`);
    }
    return seconds;
  } catch (error) {
    if (error instanceof FfmpegError) throw error;
    if (isMissingBinaryError(error)) {
      throw new FfmpegError(
        "ffprobe isn't installed or isn't on PATH. It normally ships alongside ffmpeg — reinstall ffmpeg and confirm `ffprobe -version` works."
      );
    }
    throw new FfmpegError(
      `ffprobe failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// Decodes any audio file to raw mono 16-bit little-endian PCM at `sampleRate`
// and returns the bytes — used by lib/mouth-flap.ts to read a take's loudness
// envelope. Not run through runFfmpeg because that helper discards stdout.
export async function decodeMonoPcm16(filePath: string, sampleRate: number): Promise<Buffer> {
  try {
    const { stdout } = await execFileAsync(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-i", filePath, "-vn", "-ac", "1", "-ar", String(sampleRate), "-f", "s16le", "-"],
      { encoding: "buffer", maxBuffer: MAX_BUFFER }
    );
    return stdout;
  } catch (error) {
    if (isMissingBinaryError(error)) {
      throw new FfmpegError(
        "ffmpeg isn't installed or isn't on PATH. Install ffmpeg and confirm `ffmpeg -version` works, then try again."
      );
    }
    throw new FfmpegError(`ffmpeg audio decode failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// A generated clip's native frame rate — used to decide whether a real
// image-to-video clip needs true motion interpolation instead of plain frame
// duplication when normalized to the assembly's target fps (see
// frameRateFilter in video-assembly.ts). r_frame_rate comes back as a
// fraction string (e.g. "24/1", "30000/1001"), not a decimal.
export async function probeFps(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", filePath],
      { maxBuffer: MAX_BUFFER }
    );
    const [num, den] = stdout.trim().split("/").map(Number);
    const fps = den ? num / den : num;
    if (!Number.isFinite(fps) || fps <= 0) {
      throw new FfmpegError(`ffprobe returned an invalid frame rate for ${filePath}: "${stdout.trim()}"`);
    }
    return fps;
  } catch (error) {
    if (error instanceof FfmpegError) throw error;
    if (isMissingBinaryError(error)) {
      throw new FfmpegError(
        "ffprobe isn't installed or isn't on PATH. It normally ships alongside ffmpeg — reinstall ffmpeg and confirm `ffprobe -version` works."
      );
    }
    throw new FfmpegError(`ffprobe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// A still's pixel dimensions — lib/mouth-flap.ts needs them to map a mouth
// box found at analysis resolution back onto the full-size image.
export async function probeImageSize(filePath: string): Promise<{ width: number; height: number }> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", filePath],
      { maxBuffer: MAX_BUFFER }
    );
    const [width, height] = stdout.trim().split(",").map(Number);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new FfmpegError(`ffprobe returned invalid dimensions for ${filePath}: "${stdout.trim()}"`);
    }
    return { width, height };
  } catch (error) {
    if (error instanceof FfmpegError) throw error;
    if (isMissingBinaryError(error)) {
      throw new FfmpegError(
        "ffprobe isn't installed or isn't on PATH. It normally ships alongside ffmpeg — reinstall ffmpeg and confirm `ffprobe -version` works."
      );
    }
    throw new FfmpegError(`ffprobe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Blurred absolute difference of two stills, as raw 8-bit gray at
// `width`x`height` — the input to lib/mouth-flap.ts's mouth-box search. The
// blur is what makes the search work: it merges the separately-drawn lip,
// teeth and jaw changes into one blob while flattening the sparse 1px
// redraw noise the image model sprinkles over the rest of the frame.
// Not run through runFfmpeg because that helper discards stdout.
export async function diffImagesGray(
  basePath: string,
  otherPath: string,
  width: number,
  height: number,
  blurSigma: number
): Promise<Buffer> {
  try {
    const { stdout } = await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error",
        "-i", basePath,
        "-i", otherPath,
        "-filter_complex",
        `[0:v]scale=${width}:${height}[a];[1:v]scale=${width}:${height}[b];` +
          `[a][b]blend=all_mode=difference,format=gray,gblur=sigma=${blurSigma}`,
        "-f", "rawvideo", "-pix_fmt", "gray", "-",
      ],
      { encoding: "buffer", maxBuffer: MAX_BUFFER }
    );
    return stdout;
  } catch (error) {
    if (isMissingBinaryError(error)) {
      throw new FfmpegError(
        "ffmpeg isn't installed or isn't on PATH. Install ffmpeg and confirm `ffmpeg -version` works, then try again."
      );
    }
    throw new FfmpegError(`ffmpeg image diff failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
