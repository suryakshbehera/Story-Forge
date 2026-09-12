"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { InFlightJob } from "@/lib/generation-claims";

function elapsed(startedAt: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

// site-header.tsx is a Server Component with no project context — this is
// the one client island in it, deriving the current project from the URL
// (same pattern project-nav.tsx uses) rather than being passed one, since
// it needs to work — or stay quietly absent — on every route in the app,
// not just inside a project.
export function JobTray() {
  const pathname = usePathname();
  const projectId = pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null;
  const [jobs, setJobs] = useState<InFlightJob[]>([]);
  const [, forceTick] = useState(0);

  useEffect(() => {
    // No projectId (outside any /projects/[id] route) — nothing to poll.
    // Stale `jobs` from a previous project is harmless: the render guard
    // below already requires `projectId` to be truthy before showing
    // anything.
    if (!projectId) return;
    let cancelled = false;
    async function poll() {
      const res = await fetch(`/api/projects/${projectId}/jobs`).catch(() => null);
      if (!cancelled && res?.ok) {
        const data: { jobs: InFlightJob[] } = await res.json();
        setJobs(data.jobs);
      }
    }
    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId]);

  // Re-render every second while jobs are in flight so the elapsed-time
  // labels actually count up, independent of the 5s poll cadence.
  useEffect(() => {
    if (jobs.length === 0) return;
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, [jobs.length]);

  if (!projectId || jobs.length === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" />
      {jobs.length === 1 ? (
        <Link href={jobs[0].href} className="hover:text-foreground">
          {jobs[0].label} · {elapsed(jobs[0].startedAt)}
        </Link>
      ) : (
        <span>{jobs.length} generating…</span>
      )}
    </div>
  );
}
