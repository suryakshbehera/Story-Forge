"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelect } from "@/components/model-select";
import { LanguageSelect } from "@/components/language-select";
import { VersionsPanel, type VersionItem } from "@/components/versions-panel";
import { Sparkles, Save } from "lucide-react";

interface BibleFields {
  premise: string;
  genre: string;
  tone: string;
  language: string;
  worldRules: string;
  visualStyle: string;
  timelineNotes: string;
}

export function StoryBibleEditor({
  projectId,
  initialFields,
  initialContent,
  initialVersions,
}: {
  projectId: string;
  initialFields: BibleFields;
  initialContent: string;
  initialVersions: VersionItem[];
}) {
  const [fields, setFields] = useState(initialFields);
  const [content, setContent] = useState(initialContent);
  const [savedContent, setSavedContent] = useState(initialContent);
  const [versions, setVersions] = useState(initialVersions);
  const [instructions, setInstructions] = useState("");
  const [modelId, setModelId] = useState("");
  const [savingFields, setSavingFields] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  function updateField<K extends keyof BibleFields>(key: K, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function refreshVersions() {
    const res = await fetch(`/api/projects/${projectId}/story-bible/versions`);
    if (res.ok) setVersions(await res.json());
  }

  async function saveFields() {
    setSavingFields(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/story-bible`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error();
      toast.success("Story Bible setup saved.");
    } catch {
      toast.error("Couldn't save Story Bible setup.");
    } finally {
      setSavingFields(false);
    }
  }

  async function generate() {
    if (!modelId) {
      toast.error("Pick a model first.");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/story-bible/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, instructions }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Generation failed");
      }
      const data = await res.json();
      setContent(data.storyBible.content ?? "");
      setSavedContent(data.storyBible.content ?? "");
      await refreshVersions();
      toast.success("Story Bible generated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function saveEdit() {
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/story-bible/content`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error();
      setSavedContent(content);
      await refreshVersions();
      toast.success("Edit saved as a new version.");
    } catch {
      toast.error("Couldn't save the edit.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function selectVersion(versionId: string) {
    setRestoringId(versionId);
    try {
      const res = await fetch(`/api/projects/${projectId}/story-bible/versions/${versionId}/select`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setContent(data.storyBible.content ?? "");
      setSavedContent(data.storyBible.content ?? "");
      await refreshVersions();
    } catch {
      toast.error("Couldn't restore that version.");
    } finally {
      setRestoringId(null);
    }
  }

  const dirty = content !== savedContent;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Story Bible Setup</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Field label="Premise">
              <Textarea
                rows={3}
                value={fields.premise}
                onChange={(e) => updateField("premise", e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Genre">
                <Input value={fields.genre} onChange={(e) => updateField("genre", e.target.value)} />
              </Field>
              <Field label="Tone">
                <Input value={fields.tone} onChange={(e) => updateField("tone", e.target.value)} />
              </Field>
              <Field label="Language">
                <LanguageSelect value={fields.language} onChange={(v) => updateField("language", v)} />
              </Field>
            </div>
            <Field label="World rules">
              <Textarea
                rows={3}
                value={fields.worldRules}
                onChange={(e) => updateField("worldRules", e.target.value)}
              />
            </Field>
            <Field label="Visual style">
              <Textarea
                rows={2}
                value={fields.visualStyle}
                onChange={(e) => updateField("visualStyle", e.target.value)}
              />
            </Field>
            <Field label="Timeline notes">
              <Textarea
                rows={2}
                value={fields.timelineNotes}
                onChange={(e) => updateField("timelineNotes", e.target.value)}
              />
            </Field>
            <Button onClick={saveFields} disabled={savingFields} variant="outline" className="mt-1">
              <Save className="size-4" />
              {savingFields ? "Saving…" : "Save Setup"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generate</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Field label="Model">
              <ModelSelect jobType="STORY_WRITING" value={modelId} onChange={setModelId} />
            </Field>
            <Field label="Instructions">
              <Textarea
                rows={3}
                placeholder='e.g. "Focus on the political factions" or "Write it now."'
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </Field>
            <Button onClick={generate} disabled={generating}>
              <Sparkles className="size-4" />
              {generating ? "Generating…" : "Generate Story Bible"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4 lg:col-span-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Story Bible Content</CardTitle>
            <Button size="sm" onClick={saveEdit} disabled={!dirty || savingEdit}>
              <Save className="size-4" />
              {savingEdit ? "Saving…" : "Save Edit"}
            </Button>
          </CardHeader>
          <CardContent>
            <Textarea
              rows={20}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Generated (or manually written) Story Bible content will appear here."
              className="font-mono text-sm"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Versions</CardTitle>
          </CardHeader>
          <CardContent>
            <VersionsPanel versions={versions} onSelect={selectVersion} disabled={restoringId !== null} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
