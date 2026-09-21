"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Receipt } from "lucide-react";

interface EpisodeRender {
  id: string;
  url: string;
  language: string | null;
  fileName: string | null;
}

interface Episode {
  id: string;
  number: number;
  title: string | null;
  summary: string | null;
  // The selected render per language (primary first) — see the query in
  // seasons/page.tsx for why only selected takes are loaded here.
  finalVideos: EpisodeRender[];
}

interface Season {
  id: string;
  number: number;
  title: string | null;
  episodes: Episode[];
}

// Per-episode rollup from /api/projects/[id]/spend — see that route for how
// an event is walked back to its episode, and why `uncostedCalls` matters.
interface EpisodeSpend {
  episodeId: string;
  usd: number;
  calls: number;
  uncostedCalls: number;
  failedCalls: number;
}

// Sub-cent totals are real but round to $0.00, which reads as "this was
// free" — show them as a floor instead.
function formatUsd(usd: number): string {
  if (usd <= 0) return "$0.00";
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

function spendTitle(rows: EpisodeSpend[]): string {
  const calls = rows.reduce((a, r) => a + r.calls, 0);
  const uncosted = rows.reduce((a, r) => a + r.uncostedCalls, 0);
  const failed = rows.reduce((a, r) => a + r.failedCalls, 0);
  return [
    `${calls} generation call${calls === 1 ? "" : "s"}`,
    `${uncosted} reported no price`,
    `${failed} failed`,
  ].join(" · ");
}

export function SeasonsManager({
  projectId,
  initialSeasons,
}: {
  projectId: string;
  initialSeasons: Season[];
}) {
  const [seasons, setSeasons] = useState(initialSeasons);
  // Spend is off by default and fetched on first reveal — it's an aggregate
  // over every generation event for the project, not something this page
  // should pay for on every load just to keep it hidden behind a toggle.
  const [showSpend, setShowSpend] = useState(false);
  const [spend, setSpend] = useState<Record<string, EpisodeSpend> | null>(null);
  const [loadingSpend, setLoadingSpend] = useState(false);

  async function toggleSpend() {
    if (showSpend) {
      setShowSpend(false);
      return;
    }
    setShowSpend(true);
    if (spend) return;
    setLoadingSpend(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/spend`);
      if (!res.ok) throw new Error();
      const data: { episodes: EpisodeSpend[] } = await res.json();
      setSpend(Object.fromEntries(data.episodes.map((e) => [e.episodeId, e])));
    } catch {
      toast.error("Couldn't load spend.");
      setShowSpend(false);
    } finally {
      setLoadingSpend(false);
    }
  }

  const spendFor = (episodeId: string): EpisodeSpend =>
    spend?.[episodeId] ?? { episodeId, usd: 0, calls: 0, uncostedCalls: 0, failedCalls: 0 };

  async function addSeason(number: number, title: string) {
    const res = await fetch(`/api/projects/${projectId}/seasons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number, title: title || null }),
    });
    if (!res.ok) {
      toast.error("Couldn't create season.");
      return;
    }
    const season = await res.json();
    setSeasons((prev) => [...prev, { ...season, episodes: [] }].sort((a, b) => a.number - b.number));
    toast.success(`Season ${number} added.`);
  }

  async function addEpisode(seasonId: string, number: number, title: string, summary: string) {
    const res = await fetch(`/api/seasons/${seasonId}/episodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number, title: title || null, summary: summary || null }),
    });
    if (!res.ok) {
      toast.error("Couldn't create episode.");
      return;
    }
    const episode = await res.json();
    setSeasons((prev) =>
      prev.map((s) =>
        s.id === seasonId
          // finalVideos: the POST response is the bare Episode row, with no
          // renders relation — a brand-new episode has none anyway.
          ? { ...s, episodes: [...s.episodes, { ...episode, finalVideos: [] }].sort((a, b) => a.number - b.number) }
          : s
      )
    );
    toast.success(`Episode ${number} added.`);
  }

  return (
    <div className="flex flex-col gap-4">
      {seasons.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={toggleSpend} disabled={loadingSpend}>
            <Receipt className="size-4" />
            {loadingSpend ? "Loading…" : showSpend ? "Hide spend" : "Show spend"}
          </Button>
          <AddSeasonDialog nextNumber={seasons.length + 1} onAdd={addSeason} />
        </div>
      )}

      {showSpend && spend && (
        <p className="text-right text-xs text-muted-foreground">
          Recorded API cost only. Voice, music and sound-effect providers don&apos;t report a price, and local
          renders are free — so real spend is higher than shown. Hover a figure for the call breakdown.
        </p>
      )}

      {seasons.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
            <p>No seasons yet. Add your first season to start planning episodes.</p>
            <AddSeasonDialog nextNumber={seasons.length + 1} onAdd={addSeason} />
          </CardContent>
        </Card>
      ) : (
        seasons.map((season) => (
          <Card key={season.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <span>
                  Season {season.number}
                  {season.title ? ` — ${season.title}` : ""}
                </span>
                {showSpend && spend && (
                  <span
                    className="rounded-full border px-2 py-0.5 text-xs font-normal text-muted-foreground"
                    title={spendTitle(season.episodes.map((ep) => spendFor(ep.id)))}
                  >
                    {formatUsd(season.episodes.reduce((sum, ep) => sum + spendFor(ep.id).usd, 0))} this season
                  </span>
                )}
              </CardTitle>
              {season.episodes.length > 0 && (
                <AddEpisodeDialog
                  seasonId={season.id}
                  nextNumber={season.episodes.length + 1}
                  onAdd={addEpisode}
                />
              )}
            </CardHeader>
            <CardContent>
              {season.episodes.length === 0 ? (
                <div className="flex items-center gap-2">
                  <p className="text-sm text-muted-foreground">No episodes yet.</p>
                  <AddEpisodeDialog
                    seasonId={season.id}
                    nextNumber={season.episodes.length + 1}
                    onAdd={addEpisode}
                  />
                </div>
              ) : (
                <div className="flex flex-col divide-y">
                  {season.episodes.map((ep) => (
                    <div key={ep.id} className="flex flex-col gap-2 py-2">
                      {/* The players below sit outside this Link on purpose — a
                          <video> inside it would navigate away on every click
                          of play/scrub instead of playing. */}
                      <Link
                        href={`/projects/${projectId}/seasons/${season.id}/episodes/${ep.id}`}
                        className="flex items-center justify-between text-sm hover:text-foreground"
                      >
                        <span className="shrink-0">
                          <span className="font-medium">E{ep.number}</span>
                          {ep.title ? ` — ${ep.title}` : ""}
                        </span>
                        {ep.summary && (
                          <span className="ml-4 min-w-0 truncate text-xs text-muted-foreground">{ep.summary}</span>
                        )}
                        {showSpend && spend && (
                          <span
                            className="ml-3 shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                            title={spendTitle([spendFor(ep.id)])}
                          >
                            {formatUsd(spendFor(ep.id).usd)}
                          </span>
                        )}
                      </Link>
                      {ep.finalVideos.length > 0 && (
                        <div className="flex flex-wrap gap-3">
                          {ep.finalVideos.map((video) => (
                            <div key={video.id} className="flex flex-col gap-1">
                              <video controls src={video.url} className="h-28 w-48 rounded border object-cover" />
                              <span className="text-xs text-muted-foreground">
                                {video.language ?? "Original"}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function AddSeasonDialog({
  nextNumber,
  onAdd,
}: {
  nextNumber: number;
  onAdd: (number: number, title: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState(nextNumber);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setNumber(nextNumber);
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        Add Season
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Season</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Number</Label>
            <Input type="number" value={number} onChange={(e) => setNumber(Number(e.target.value))} />
          </div>
          <div className="grid gap-2">
            <Label>Title (optional)</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              await onAdd(number, title);
              setSubmitting(false);
              setOpen(false);
              setTitle("");
            }}
          >
            {submitting ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddEpisodeDialog({
  seasonId,
  nextNumber,
  onAdd,
}: {
  seasonId: string;
  nextNumber: number;
  onAdd: (seasonId: string, number: number, title: string, summary: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState(nextNumber);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setNumber(nextNumber);
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Plus className="size-4" />
        Add Episode
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Episode</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>Number</Label>
            <Input type="number" value={number} onChange={(e) => setNumber(Number(e.target.value))} />
          </div>
          <div className="grid gap-2">
            <Label>Title (optional)</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Summary (optional)</Label>
            <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              await onAdd(seasonId, number, title, summary);
              setSubmitting(false);
              setOpen(false);
              setTitle("");
              setSummary("");
            }}
          >
            {submitting ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
