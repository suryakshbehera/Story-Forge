"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageIcon, Upload, X } from "lucide-react";

// Sits inside the project card's <Link> (see app/page.tsx) — every handler
// here stops propagation, same convention as ProjectCardMenu, so uploading
// or removing the cover never triggers the card's own navigation.
export function ProjectCoverImage({
  projectId,
  storageKey,
}: {
  projectId: string;
  storageKey: string | null;
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/cover-image`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Upload failed");
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const res = await fetch(`/api/projects/${projectId}/cover-image`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't remove image.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="group relative -mx-(--card-spacing) -mt-(--card-spacing) aspect-video overflow-hidden rounded-t-xl border-b bg-muted">
      {storageKey ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/storage/${storageKey}`}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ImageIcon className="size-6" />
        </div>
      )}

      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            inputRef.current?.click();
          }}
          disabled={uploading}
          className="flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-black hover:bg-white disabled:opacity-50"
        >
          <Upload className="size-3.5" />
          {uploading ? "Uploading…" : storageKey ? "Replace" : "Add image"}
        </button>
        {storageKey && (
          <button
            type="button"
            onClick={handleRemove}
            className="flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-black hover:bg-white"
            aria-label="Remove image"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => handleFile(e.target.files)}
      />
    </div>
  );
}
