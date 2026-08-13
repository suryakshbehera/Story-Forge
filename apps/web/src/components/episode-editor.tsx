"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Save } from "lucide-react";

export function EpisodeEditor({
  episodeId,
  initialNumber,
  initialTitle,
  initialSummary,
}: {
  episodeId: string;
  initialNumber: number;
  initialTitle: string;
  initialSummary: string;
}) {
  const [number, setNumber] = useState(initialNumber);
  const [title, setTitle] = useState(initialTitle);
  const [summary, setSummary] = useState(initialSummary);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number, title: title || null, summary: summary || null }),
      });
      if (!res.ok) throw new Error();
      toast.success("Episode saved.");
    } catch {
      toast.error("Couldn't save episode.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[100px_1fr] gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Number</Label>
          <Input type="number" value={number} onChange={(e) => setNumber(Number(e.target.value))} />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs text-muted-foreground">
          Summary <span className="opacity-70">(feeds later episodes via the Context Engine)</span>
        </Label>
        <Textarea rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </div>
      <Button onClick={save} disabled={saving} className="self-start">
        <Save className="size-4" />
        {saving ? "Saving…" : "Save Episode"}
      </Button>
    </div>
  );
}
