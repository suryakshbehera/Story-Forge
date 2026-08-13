import { promises as fs } from "fs";
import path from "path";

// Local-disk implementation for V1. Swapping to S3/R2 later means adding a
// new class that implements this interface — call sites never change.
export interface StorageProvider {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
  url(key: string): string;
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
}

export const storage: StorageProvider = new LocalDiskStorageProvider();

export function buildStorageKey(scope: string, id: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${scope}/${id}/${Date.now()}-${safeName}`;
}
