"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export function NewProjectDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"SINGLE" | "SERIES">("SINGLE");
  const [premise, setPremise] = useState("");
  const [genre, setGenre] = useState("");
  const [duration, setDuration] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Give the project a name first.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          premise: premise.trim() || undefined,
          genre: genre.trim() || undefined,
          duration: duration.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const project = await res.json();
      setOpen(false);
      setName("");
      setPremise("");
      setGenre("");
      setDuration("");
      router.push(`/projects/${project.id}`);
      router.refresh();
    } catch {
      toast.error("Couldn't create the project. Check the server logs.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="size-4" />
        New Project
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Invisible Richest Man"
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="project-type">Type</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as "SINGLE" | "SERIES")}
              items={{ SINGLE: "Single Video", SERIES: "Series" }}
            >
              <SelectTrigger id="project-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SINGLE">Single Video</SelectItem>
                <SelectItem value="SERIES">Series</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="project-premise">What&apos;s it about? (optional)</Label>
            <Textarea
              id="project-premise"
              rows={2}
              value={premise}
              onChange={(e) => setPremise(e.target.value)}
              placeholder="e.g. A retired locksmith discovers the last door in the city he's never opened."
            />
          </div>
          <div className="flex gap-3">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="project-genre">Genre (optional)</Label>
              <Input id="project-genre" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="e.g. Mystery" />
            </div>
            {type === "SINGLE" && (
              <div className="grid flex-1 gap-2">
                <Label htmlFor="project-duration">Rough length (optional)</Label>
                <Input
                  id="project-duration"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder="e.g. 8 minutes"
                />
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            You&apos;ll choose Illustration or Video per scene once you start planning — that&apos;s fine to leave for later.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={handleCreate} disabled={submitting}>
            {submitting ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
