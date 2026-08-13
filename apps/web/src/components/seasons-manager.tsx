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
import { Plus } from "lucide-react";

interface Episode {
  id: string;
  number: number;
  title: string | null;
  summary: string | null;
}

interface Season {
  id: string;
  number: number;
  title: string | null;
  episodes: Episode[];
}

export function SeasonsManager({
  projectId,
  initialSeasons,
}: {
  projectId: string;
  initialSeasons: Season[];
}) {
  const [seasons, setSeasons] = useState(initialSeasons);

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
          ? { ...s, episodes: [...s.episodes, episode].sort((a, b) => a.number - b.number) }
          : s
      )
    );
    toast.success(`Episode ${number} added.`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <AddSeasonDialog nextNumber={seasons.length + 1} onAdd={addSeason} />
      </div>

      {seasons.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No seasons yet. Add your first season to start planning episodes.
          </CardContent>
        </Card>
      ) : (
        seasons.map((season) => (
          <Card key={season.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                Season {season.number}
                {season.title ? ` — ${season.title}` : ""}
              </CardTitle>
              <AddEpisodeDialog
                seasonId={season.id}
                nextNumber={season.episodes.length + 1}
                onAdd={addEpisode}
              />
            </CardHeader>
            <CardContent>
              {season.episodes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No episodes yet.</p>
              ) : (
                <div className="flex flex-col divide-y">
                  {season.episodes.map((ep) => (
                    <Link
                      key={ep.id}
                      href={`/projects/${projectId}/seasons/${season.id}/episodes/${ep.id}`}
                      className="flex items-center justify-between py-2 text-sm hover:text-foreground"
                    >
                      <span>
                        <span className="font-medium">E{ep.number}</span>
                        {ep.title ? ` — ${ep.title}` : ""}
                      </span>
                      {ep.summary && (
                        <span className="ml-4 truncate text-xs text-muted-foreground">{ep.summary}</span>
                      )}
                    </Link>
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
