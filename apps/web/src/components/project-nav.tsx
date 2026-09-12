"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";
import type { ProjectStatus } from "@/lib/project-status";

export function ProjectNav({
  projectId,
  type,
  status,
}: {
  projectId: string;
  type: "SINGLE" | "SERIES";
  status: ProjectStatus;
}) {
  const pathname = usePathname();

  const base = `/projects/${projectId}`;
  // Pipeline order: Story/Bible first (everything else reads from it),
  // then Characters/Locations (referenced by scenes), then Scenes/Seasons
  // last (the actual work, gated on nothing itself). Characters/Locations
  // aren't hard requirements — a story can have zero and still work — so
  // their dot is presence-based, not a strict gate like Story's.
  const tabs =
    type === "SINGLE"
      ? [
          { href: `${base}/story`, label: "Story", done: status.storyDone },
          { href: `${base}/characters`, label: "Characters", done: status.characters.total > 0 },
          { href: `${base}/locations`, label: "Locations", done: status.locations.total > 0 },
          { href: `${base}/story/scenes`, label: "Scenes", done: status.scenes.total > 0 },
        ]
      : [
          { href: `${base}/bible`, label: "Story Bible", done: status.storyDone },
          { href: `${base}/characters`, label: "Characters", done: status.characters.total > 0 },
          { href: `${base}/locations`, label: "Locations", done: status.locations.total > 0 },
          { href: `${base}/seasons`, label: "Seasons", done: status.scenes.total > 0 },
        ];

  return (
    <nav className="flex gap-1 overflow-x-auto border-b">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {tab.done && <CheckCircle2 className="size-3.5 text-green-600" aria-label="Complete" />}
          </Link>
        );
      })}
    </nav>
  );
}
