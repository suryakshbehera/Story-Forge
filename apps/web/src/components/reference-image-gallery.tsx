"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, X } from "lucide-react";

interface ImageAsset {
  id: string;
  storageKey: string;
  fileName: string | null;
}

export function ReferenceImageGallery({
  uploadUrl,
  deleteUrlBase,
  initialImages,
}: {
  uploadUrl: string;
  deleteUrlBase: string;
  initialImages: ImageAsset[];
}) {
  const [images, setImages] = useState(initialImages);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(uploadUrl, { method: "POST", body: formData });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Upload failed");
        }
        const asset = await res.json();
        setImages((prev) => [...prev, asset]);
      }
      toast.success("Image uploaded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete(assetId: string) {
    const res = await fetch(`${deleteUrlBase}/${assetId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete image.");
      return;
    }
    setImages((prev) => prev.filter((img) => img.id !== assetId));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {images.map((img) => (
          <div key={img.id} className="group relative aspect-square overflow-hidden rounded-md border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/storage/${img.storageKey}`}
              alt={img.fileName ?? "Reference image"}
              className="h-full w-full object-cover"
            />
            <button
              type="button"
              onClick={() => handleDelete(img.id)}
              className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
              aria-label="Delete image"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
        >
          <Upload className="size-4" />
          <span className="text-xs">{uploading ? "Uploading…" : "Add"}</span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
