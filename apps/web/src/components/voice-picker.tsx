"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Play, Search } from "lucide-react";
import type { VoiceCatalogEntry } from "@/app/api/voices/route";

// Module-level cache/in-flight dedup — same reasoning as
// lib/model-registry-cache.ts: several pickers can be open across a page
// (per-character forms, the narrator field), no reason to refetch the same
// catalog for each. Keyed by language since /api/voices' response now
// depends on it (a Sarvam-unsupported language drops the Sarvam half) —
// every picker on a page shares one project language, so this still
// collapses to one in-flight fetch per page in practice.
const voicesPromiseCache = new Map<string, Promise<VoiceCatalogEntry[]>>();
function getVoiceCatalog(language: string | null | undefined): Promise<VoiceCatalogEntry[]> {
  const key = language ?? "";
  let entry = voicesPromiseCache.get(key);
  if (!entry) {
    const url = key ? `/api/voices?language=${encodeURIComponent(key)}` : "/api/voices";
    entry = fetch(url)
      .then((res) => res.json())
      .then((data: { voices: VoiceCatalogEntry[] }) => data.voices)
      .catch(() => {
        voicesPromiseCache.delete(key);
        return [];
      });
    voicesPromiseCache.set(key, entry);
  }
  return entry;
}

// Keeps the underlying value plain free text (Character.voiceName /
// Project.narratorVoiceName stay provider-agnostic strings, no schema
// change) — this only makes picking a well-formed one easier than typing
// an ID by hand. Manual entry still works: the text Input next to the
// Browse button accepts anything, same "AI/tools propose, never force"
// idiom as the rest of the app.
export function VoicePicker({
  value,
  onChange,
  language,
}: {
  value: string;
  onChange: (v: string) => void;
  // The project's Story/StoryBible.language (see lib/languages.ts's
  // resolveProjectLanguage) — narrows out Sarvam voices that can't actually
  // speak this language. Optional: omitted, the picker shows every voice,
  // same as before this prop existed.
  language?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [voices, setVoices] = useState<VoiceCatalogEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Tracks which language `voices` was loaded for, so a reopen with the same
  // language reuses state instead of flashing back to "Loading…" — only a
  // genuine language change (or first open) triggers a refetch.
  const loadedLanguageRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    if (voices !== null && loadedLanguageRef.current === language) return;
    loadedLanguageRef.current = language;
    getVoiceCatalog(language).then(setVoices);
  }, [open, voices, language]);

  function play(previewUrl: string) {
    audioRef.current?.pause();
    const audio = new Audio(previewUrl);
    audioRef.current = audio;
    audio.play().catch(() => {});
  }

  const filtered = (voices ?? []).filter((v) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return v.name.toLowerCase().includes(q) || v.voiceId.toLowerCase().includes(q);
  });

  return (
    <div className="flex gap-2">
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Voice ID / speaker name" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button type="button" variant="outline" />}>Browse voices</DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Choose a voice</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name…"
                className="pl-7"
              />
            </div>
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {voices === null && <p className="p-2 text-xs text-muted-foreground">Loading voices…</p>}
              {voices !== null && filtered.length === 0 && (
                <p className="p-2 text-xs text-muted-foreground">No voices match &quot;{query}&quot;.</p>
              )}
              {filtered.map((v) => (
                <div
                  key={`${v.provider}-${v.voiceId}`}
                  className={`flex items-center gap-2 rounded-md border p-2 ${value === v.voiceId ? "border-foreground" : ""}`}
                >
                  {v.previewUrl ? (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Play ${v.name} sample`}
                      onClick={() => play(v.previewUrl!)}
                    >
                      <Play className="size-3.5" />
                    </Button>
                  ) : (
                    <span className="size-7" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{v.name}</p>
                    {v.description && <p className="text-xs text-muted-foreground">{v.description}</p>}
                  </div>
                  <span className="text-xs text-muted-foreground capitalize">{v.provider}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant={value === v.voiceId ? "default" : "outline"}
                    onClick={() => {
                      onChange(v.voiceId);
                      setOpen(false);
                    }}
                  >
                    {value === v.voiceId ? "Selected" : "Use this"}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
