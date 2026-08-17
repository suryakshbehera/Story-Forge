"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelect } from "@/components/model-select";
import { VersionsPanel, type VersionItem } from "@/components/versions-panel";
import { Sparkles, Save } from "lucide-react";

interface BlueprintFields {
  actStructure: string;
  sceneShotGuidance: string;
  runtimeTarget: string;
  tone: string;
}

// Structural clone of StoryBibleEditor — same Setup/Generate/Content/
// Versions shape, different fields. Kept as its own component (rather than
// parameterizing StoryBibleEditor) since the two entities' fields and routes
// differ enough that a shared abstraction would need as many branches as it
// saves lines.
export function BlueprintEditor({
  projectId,
  initialFields,
  initialContent,
  initialVersions,
}: {
  projectId: string;
  initialFields: BlueprintFields;
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

  function updateField<K extends keyof BlueprintFields>(key: K, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function refreshVersions() {
    const res = await fetch(`/api/projects/${projectId}/blueprint/versions`);
    if (res.ok) setVersions(await res.json());
  }

  async function saveFields() {
    setSavingFields(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/blueprint`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error();
      toast.success("Blueprint setup saved.");
    } catch {
      toast.error("Couldn't save Blueprint setup.");
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
      const res = await fetch(`/api/projects/${projectId}/blueprint/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, instructions }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Generation failed");
      }
      const data = await res.json();
      setContent(data.blueprint.content ?? "");
      setSavedContent(data.blueprint.content ?? "");
      await refreshVersions();
      toast.success("Series Blueprint generated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function saveEdit() {
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/blueprint/content`, {
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
      const res = await fetch(`/api/projects/${projectId}/blueprint/versions/${versionId}/select`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setContent(data.blueprint.content ?? "");
      setSavedContent(data.blueprint.content ?? "");
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
            <CardTitle className="text-base">Series Blueprint Setup</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Field label="Act structure">
              <Textarea
                rows={3}
                placeholder='e.g. "3-act: cold open, escalation, resolution"'
                value={fields.actStructure}
                onChange={(e) => updateField("actStructure", e.target.value)}
              />
            </Field>
            <Field label="Typical scene/shot guidance">
              <Textarea
                rows={2}
                placeholder='e.g. "6-8 scenes per episode, 2-3 shots per scene"'
                value={fields.sceneShotGuidance}
                onChange={(e) => updateField("sceneShotGuidance", e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Runtime target">
                <Input
                  placeholder='e.g. "8-10 minutes"'
                  value={fields.runtimeTarget}
                  onChange={(e) => updateField("runtimeTarget", e.target.value)}
                />
              </Field>
              <Field label="Tone">
                <Input value={fields.tone} onChange={(e) => updateField("tone", e.target.value)} />
              </Field>
            </div>
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
              <ModelSelect jobType="BLUEPRINT_PLANNING" value={modelId} onChange={setModelId} />
            </Field>
            <Field label="Instructions">
              <Textarea
                rows={3}
                placeholder='e.g. "Keep episodes short and punchy" or "Draft it now."'
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </Field>
            <Button onClick={generate} disabled={generating}>
              <Sparkles className="size-4" />
              {generating ? "Generating…" : "Generate Blueprint"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4 lg:col-span-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Blueprint Content</CardTitle>
            <Button size="sm" onClick={saveEdit} disabled={!dirty || savingEdit}>
              <Save className="size-4" />
              {savingEdit ? "Saving…" : "Save Edit"}
            </Button>
          </CardHeader>
          <CardContent>
            <Textarea
              rows={14}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Generated (or manually written) Blueprint content will appear here."
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
