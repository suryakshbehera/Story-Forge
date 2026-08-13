"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function ProjectNav({
  projectId,
  type,
}: {
  projectId: string;
  type: "SINGLE" | "SERIES";
}) {
  const pathname = usePathname();

  const base = `/projects/${projectId}`;
  const tabs =
    type === "SINGLE"
      ? [
          { href: `${base}/story`, label: "Story" },
          { href: `${base}/story/scenes`, label: "Scenes" },
        ]
      : [
          { href: `${base}/bible`, label: "Story Bible" },
          { href: `${base}/seasons`, label: "Seasons" },
        ];

  tabs.push(
    { href: `${base}/characters`, label: "Characters" },
    { href: `${base}/locations`, label: "Locations" }
  );

  return (
    <nav className="flex gap-1 border-b">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
