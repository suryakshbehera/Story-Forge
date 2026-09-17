import { promises as fs, createReadStream } from "fs";
import { Readable } from "stream";
import path from "path";

// Local-disk implementation for V1. Swapping to S3/R2 later means adding a
// new class that implements this interface — call sites never change.
export interface StorageProvider {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
  url(key: string): string;
  /** null when the key doesn't exist. Backs the storage route's ETag/206 support — see mobile-technical-plan-2026-09.md §3.2. */
  stat(key: string): Promise<{ size: number; mtimeMs: number } | null>;
  /** null when the key doesn't exist. A byte range, when given, must already be validated against stat()'s size. */
  stream(key: string, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array> | null>;
}

const STORAGE_ROOT = path.resolve(process.cwd(), process.env.STORAGE_ROOT ?? "../../storage");

function resolveKeyPath(key: string): string {
  const fullPath = path.normalize(path.join(STORAGE_ROOT, key));
  if (!fullPath.startsWith(STORAGE_ROOT)) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return fullPath;
}

export class LocalDiskStorageProvider implements StorageProvider {
  async put(key: string, data: Buffer): Promise<void> {
    const fullPath = resolveKeyPath(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(resolveKeyPath(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await fs.unlink(resolveKeyPath(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  url(key: string): string {
    return `/api/storage/${key}`;
  }

  async stat(key: string): Promise<{ size: number; mtimeMs: number } | null> {
    try {
      const info = await fs.stat(resolveKeyPath(key));
      return { size: info.size, mtimeMs: info.mtimeMs };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  // No existence check here — callers are expected to have already called
  // stat() (the storage route always does, to build the ETag), so a missing
  // file at this point is a race, not the normal "not found" path. A
  // resulting stream-error would surface as a failed response rather than a
  // clean 404, same trade-off the original whole-buffer get() made simpler
  // by reading everything eagerly.
  async stream(key: string, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array> | null> {
    const fullPath = resolveKeyPath(key);
    const nodeStream = range
      ? createReadStream(fullPath, { start: range.start, end: range.end })
      : createReadStream(fullPath);
    return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  }
}

export const storage: StorageProvider = new LocalDiskStorageProvider();

export function buildStorageKey(scope: string, id: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${scope}/${id}/${Date.now()}-${safeName}`;
}
