"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ModelSelect } from "@/components/model-select";
import { FileText, Sparkles, Check, X, Trash2, ExternalLink } from "lucide-react";
import type { IngestionPreview, NameMatch } from "@/lib/story-ingestion";

interface SourceDocument {
  id: string;
  fileName: string | null;
  storageKey: string;
  createdAt: string;
}

// Phase 9 — the "kill per-episode setup repetition" entry point. Parsing is
// a preview only: nothing lands in StoryBible/SeriesBlueprint/Character/
// Location until Apply is clicked, same "AI prepares, user approves" pattern
// as every other generation flow in the app — this just fans out to four
// entities instead of one, hence the extra review step before committing.
export function DocumentIngestPanel({
  projectId,
  initialSourceDocuments,
}: {
  projectId: string;
  initialSourceDocuments: SourceDocument[];
}) {
  const [sourceDocuments, setSourceDocuments] = useState(initialSourceDocuments);
  const [file, setFile] = useState<File | null>(null);
  const [modelId, setModelId] = useState("");
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<IngestionPreview | null>(null);
  const [matches, setMatches] = useState<{ characters: NameMatch[]; locations: NameMatch[] } | null>(null);
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function parseDocument() {
    if (!file) {
      toast.error("Choose a PDF or .docx file first.");
      return;
    }
    if (!modelId) {
      toast.error("Pick a model first.");
      return;
    }
    setParsing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("modelId", modelId);
      const res = await fetch(`/api/projects/${projectId}/ingest`, { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Parsing failed");

      setPreview(data.preview);
      setMatches(data.matches);
      setSourceFileName(file.name);
      if (data.sourceAsset) {
        setSourceDocuments((prev) => [data.sourceAsset, ...prev]);
      }
      toast.success("Document parsed — review the preview below before applying.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Parsing failed.");
    } finally {
      setParsing(false);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function discardPreview() {
    setPreview(null);
    setMatches(null);
    setSourceFileName(null);
  }

  async function applyPreview() {
    if (!preview) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/ingest/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview, modelId, sourceFileName }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Apply failed");
      }
      toast.success("Applied to Story Bible, Blueprint, Characters, and Locations. Reloading…");
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Apply failed.");
      setApplying(false);
    }
  }

  async function deleteSourceDocument(assetId: string) {
    const res = await fetch(`/api/projects/${projectId}/ingest/${assetId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete document.");
      return;
    }
    setSourceDocuments((prev) => prev.filter((d) => d.id !== assetId));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Import from Document</CardTitle>
        <p className="text-xs text-muted-foreground">
          Upload a series bible, pitch doc, or character sheet once — it drafts the Story Bible, Series Blueprint,
          Characters, and Locations for you to review before anything is saved. Entirely optional; the fields below
          work fine on their own too.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="grid flex-1 gap-1.5">
            <Label className="text-xs text-muted-foreground">Document (PDF or .docx)</Label>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Model</Label>
            <ModelSelect jobType="STORY_INGESTION" value={modelId} onChange={setModelId} />
          </div>
          <Button onClick={parseDocument} disabled={parsing || !file}>
            <Sparkles className="size-4" />
            {parsing ? "Parsing…" : "Parse Document"}
          </Button>
        </div>

        {preview && matches && (
          <>
            <Separator />
            <div className="flex flex-col gap-4 rounded-md border p-4">
              <p className="text-sm font-medium">Preview — nothing is saved yet</p>

              <PreviewField label="Story Bible" summary={summarizeBible(preview)} content={preview.storyBible.content} />
              <PreviewField
                label="Series Blueprint"
                summary={summarizeBlueprint(preview)}
                content={preview.blueprint.content}
              />

              <NameMatchList label="Characters" matches={matches.characters} />
              <NameMatchList label="Locations" matches={matches.locations} />

              <div className="flex gap-2">
                <Button onClick={applyPreview} disabled={applying}>
                  <Check className="size-4" />
                  {applying ? "Applying…" : "Apply to Project"}
                </Button>
                <Button variant="outline" onClick={discardPreview} disabled={applying}>
                  <X className="size-4" />
                  Discard
                </Button>
              </div>
            </div>
          </>
        )}

        {sourceDocuments.length > 0 && (
          <>
            <Separator />
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Uploaded documents</Label>
              {sourceDocuments.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{doc.fileName ?? "Document"}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <a
                      href={`/api/storage/${doc.storageKey}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label="Open document"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => deleteSourceDocument(doc.id)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                      aria-label="Delete document"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function summarizeBible(preview: IngestionPreview): Array<[string, string | null | undefined]> {
  return [
    ["Premise", preview.storyBible.premise],
    ["Genre", preview.storyBible.genre],
    ["Tone", preview.storyBible.tone],
    ["Language", preview.storyBible.language],
  ];
}

function summarizeBlueprint(preview: IngestionPreview): Array<[string, string | null | undefined]> {
  return [
    ["Act structure", preview.blueprint.actStructure],
    ["Scene/shot guidance", preview.blueprint.sceneShotGuidance],
    ["Runtime target", preview.blueprint.runtimeTarget],
    ["Tone", preview.blueprint.tone],
  ];
}

function PreviewField({
  label,
  summary,
  content,
}: {
  label: string;
  summary: Array<[string, string | null | undefined]>;
  content: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">{label}</p>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        {summary
          .filter(([, value]) => value)
          .map(([key, value]) => (
            <div key={key} className="flex gap-1.5">
              <dt className="shrink-0 text-muted-foreground">{key}:</dt>
              <dd className="truncate">{value}</dd>
            </div>
          ))}
      </dl>
      <p className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs text-muted-foreground">
        {content}
      </p>
    </div>
  );
}

function NameMatchList({ label, matches }: { label: string; matches: NameMatch[] }) {
  if (matches.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {label}: none found in this document.
      </p>
    );
  }
  const newCount = matches.filter((m) => !m.isExisting).length;
  const updateCount = matches.length - newCount;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">
        {label}{" "}
        <span className="font-normal text-muted-foreground">
          ({newCount} new{updateCount > 0 ? `, ${updateCount} already exist — blanks only` : ""})
        </span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {matches.map((m) => (
          <Badge key={m.name} variant={m.isExisting ? "secondary" : "default"} className="text-[11px]">
            {m.name}
            {m.isExisting ? " (update)" : " (new)"}
          </Badge>
        ))}
      </div>
    </div>
  );
}
