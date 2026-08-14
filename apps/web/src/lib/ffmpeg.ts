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
