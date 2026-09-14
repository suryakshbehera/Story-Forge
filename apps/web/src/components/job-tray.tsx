"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { InFlightJob } from "@/lib/generation-claims";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function elapsed(startedAt: string): string {
  return formatSeconds(Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)));
}

// job.etaSeconds is computed server-side as of the last 5s poll — good
// enough as an approximation without re-deriving it every second
// client-side. 0 (or below, once it's stale) reads as running long rather
// than a nonsensical "-12s".
function etaLabel(job: InFlightJob): string | null {
  if (job.etaSeconds == null) return null;
  return job.etaSeconds > 0 ? `ETA ~${formatSeconds(job.etaSeconds)}` : "taking longer than usual";
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

  if (jobs.length === 1) {
    const job = jobs[0];
    const eta = etaLabel(job);
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        <Link href={job.href} className="hover:text-foreground">
          {job.stage} — {job.label} · {elapsed(job.startedAt)}
          {eta ? ` · ${eta}` : ""}
        </Link>
      </div>
    );
  }

  return <JobTrayList jobs={jobs} />;
}

// 2+ jobs — listing every one inline would overflow the header, so the pill
// stays a one-line summary and a dropdown lists each job (stage, label,
// elapsed, ETA) on click, replacing the old opaque "N generating…" text.
function JobTrayList({ jobs }: { jobs: InFlightJob[] }) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex items-center gap-2 rounded-md border bg-muted/50 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          />
        }
      >
        <Loader2 className="size-3.5 animate-spin" />
        {jobs.length} generating…
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        {jobs.map((job) => {
          const eta = etaLabel(job);
          return (
            <DropdownMenuItem key={`${job.jobType}-${job.label}`} onClick={() => router.push(job.href)}>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground">{job.stage}</span>
                <span className="text-xs text-muted-foreground">
                  {job.label} · {elapsed(job.startedAt)}
                  {eta ? ` · ${eta}` : ""}
                </span>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
