"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";

// Sits inside the project card's <Link> (see app/page.tsx) — every handler
// here stops propagation so opening the menu or deleting never triggers the
// card's own navigation.
export function ProjectCardMenu({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const { confirm, ConfirmDialog } = useConfirm();

  async function remove() {
    const ok = await confirm({
      title: `Delete "${projectName}"?`,
      description: "This can't be undone — all its scenes, characters, and generated assets go with it.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Project deleted.");
      router.refresh();
    } catch {
      toast.error("Couldn't delete project.");
      setDeleting(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Project menu"
            disabled={deleting}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          />
        }
      >
        <MoreVertical className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          variant="destructive"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            remove();
          }}
        >
          <Trash2 className="size-3.5" />
          Delete Project
        </DropdownMenuItem>
      </DropdownMenuContent>
      {ConfirmDialog}
    </DropdownMenu>
  );
}
