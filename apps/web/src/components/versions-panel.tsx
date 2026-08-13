"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface VersionItem {
  id: string;
  versionNumber: number;
  isSelected: boolean;
  createdBy: "USER" | "AI";
  modelId: string | null;
  createdAt: string;
}

export function VersionsPanel({
  versions,
  onSelect,
  disabled,
}: {
  versions: VersionItem[];
  onSelect: (versionId: string) => void;
  disabled?: boolean;
}) {
  if (versions.length === 0) {
    return <p className="text-sm text-muted-foreground">No versions yet — generate or save an edit.</p>;
  }

  return (
    <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
      {versions.map((v) => (
        <button
          key={v.id}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(v.id)}
          className={cn(
            "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50",
            v.isSelected && "border-foreground/40 bg-accent"
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-medium">v{v.versionNumber}</span>
            <Badge variant={v.createdBy === "AI" ? "default" : "secondary"} className="shrink-0 text-[10px]">
              {v.createdBy === "AI" ? "AI" : "You"}
            </Badge>
            {v.modelId && <span className="truncate text-xs text-muted-foreground">{v.modelId}</span>}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {new Date(v.createdAt).toLocaleString()}
          </span>
        </button>
      ))}
    </div>
  );
}
