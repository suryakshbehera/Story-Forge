"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/field";
import { ModelSelect } from "@/components/model-select";
import { VoicePicker } from "@/components/voice-picker";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Languages, Trash2, Download } from "lucide-react";
import { INDIAN_LANGUAGES } from "@/lib/languages";
import { formatFileSize } from "@/lib/format";
import type { SceneItem } from "@/components/scene-manager";
import type { FinalVideoItem } from "@/components/video-assembly-panel";

function readVoiceMap(json: unknown): Record<string, string> {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  return json as Record<string, string>;
}

export interface CharacterVoiceOption {
  id: string;
  name: string;
  voicesByLanguage: unknown;
}

// A VoicePicker plus its own uncommitted draft + Save button, for one
// (language, narrator-or-character) slot. Keyed by `${id}-${language}` at
// the call site so a language switch remounts it with a fresh draft seeded
// from `initialVoiceId` — deliberately not synced via a useEffect (that
// pattern fights React's own guidance against setState-in-effect and causes
// an extra render on every language switch); remounting is the idiomatic
// way to reset local state when a prop that identifies "which thing this is
// editing" changes.
function VoiceSaveRow({
  initialVoiceId,
  language,
  onSave,
  className,
}: {
  initialVoiceId: string;
  language: string;
  onSave: (voiceId: string) => Promise<void>;
  className?: string;
}) {
  const [draft, setDraft] = useState(initialVoiceId);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
    } catch {
      // onSave already toasts its own error — nothing further to do here.
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`flex gap-2 ${className ?? ""}`}>
      <div className="max-w-md flex-1">
        <VoicePicker value={draft} onChange={setDraft} language={language} />
      </div>
      <Button size="sm" variant="outline" onClick={save} disabled={saving || draft === initialVoiceId}>
        Save
      </Button>
    </div>
  );
}

// Dubbing — a whole extra production surface layered on top of the primary
// language's SceneManager/VideoAssemblyPanel: pick a language other than the
// project's own, translate every scene's narration/dialogue into it, assign
// per-language character/narrator voices, generate audio per scene, then
// render a full dubbed video. Deliberately a sibling panel with its own
// state (same "own Card, own state" pattern as SilentAssemblyPanel/
// AudioCuePlanPanel/VideoAssemblyPanel below it), not folded into
// SceneManager — the two flows only share their initial data, not live
// state, so editing here never risks the primary-language editing flow.
export function TranslationsPanel({
  parentType,
  parentId,
  projectId,
  primaryLanguage,
  initialScenes,
  initialCharacters,
  initialNarratorVoicesByLanguage,
  initialFinalVideos,
}: {
  parentType: "story" | "episode";
  parentId: string;
  projectId: string;
  primaryLanguage: string | null;
  initialScenes: SceneItem[];
  initialCharacters: CharacterVoiceOption[];
  initialNarratorVoicesByLanguage: unknown;
  initialFinalVideos: FinalVideoItem[];
}) {
  const targetLanguages = useMemo(() => INDIAN_LANGUAGES.filter((l) => l !== primaryLanguage), [primaryLanguage]);
  const [language, setLanguage] = useState(targetLanguages[0] ?? "");
  const [scenes, setScenes] = useState(initialScenes);
  const [characters, setCharacters] = useState(
    initialCharacters.map((c) => ({ ...c, voicesByLanguage: readVoiceMap(c.voicesByLanguage) }))
  );
  const [narratorVoicesByLanguage, setNarratorVoicesByLanguage] = useState(readVoiceMap(initialNarratorVoicesByLanguage));
  const [finalVideos, setFinalVideos] = useState(initialFinalVideos);

  const [translationModelId, setTranslationModelId] = useState("");
  const [videoModelId, setVideoModelId] = useState("");

  const [translatingAll, setTranslatingAll] = useState(false);
  const [translatingScene, setTranslatingScene] = useState<Set<string>>(new Set());
  const [generatingNarration, setGeneratingNarration] = useState<Set<string>>(new Set());
  const [generatingLine, setGeneratingLine] = useState<Set<string>>(new Set());
  const [rendering, setRendering] = useState(false);

  const existingLanguages = useMemo(() => {
    const set = new Set<string>();
    for (const s of scenes) {
      for (const t of s.translations) set.add(t.language);
    }
    return Array.from(set).sort();
  }, [scenes]);

  function sceneTranslation(scene: SceneItem) {
    return scene.translations.find((t) => t.language === language) ?? null;
  }
  function lineTranslation(line: SceneItem["dialogueLines"][number]) {
    return line.translations.find((t) => t.language === language) ?? null;
  }
  function narrationTakes(scene: SceneItem) {
    return scene.narrationAudio.filter((a) => a.language === language);
  }
  function lineTakes(line: SceneItem["dialogueLines"][number]) {
    return line.audio.filter((a) => a.language === language);
  }

  function applySceneTranslation(
    sceneId: string,
    scenePatch: { narration: string | null; narrationDeliveryNotes: string | null; narrationSpeed: number | null },
    lines: { dialogueLineId: string; text: string; deliveryNotes: string | null; speed: number | null }[]
  ) {
    setScenes((prev) =>
      prev.map((s) => {
        if (s.id !== sceneId) return s;
        return {
          ...s,
          translations: [...s.translations.filter((t) => t.language !== language), { language, ...scenePatch }],
          dialogueLines: s.dialogueLines.map((line) => {
            const updated = lines.find((d) => d.dialogueLineId === line.id);
            if (!updated) return line;
            return {
              ...line,
              translations: [
                ...line.translations.filter((t) => t.language !== language),
                { language, text: updated.text, deliveryNotes: updated.deliveryNotes, speed: updated.speed },
              ],
            };
          }),
        };
      })
    );
  }

  async function translateScene(sceneId: string) {
    setTranslatingScene((prev) => new Set(prev).add(sceneId));
    try {
      const res = await fetch(`/api/scenes/${sceneId}/translation/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, modelId: translationModelId || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Translation failed.");
      }
      const data: {
        scene: { narration: string | null; narrationDeliveryNotes: string | null; narrationSpeed: number | null };
        dialogueLines: { dialogueLineId: string; text: string; deliveryNotes: string | null; speed: number | null }[];
      } = await res.json();
      applySceneTranslation(sceneId, data.scene, data.dialogueLines);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Translation failed.");
      throw error;
    } finally {
      setTranslatingScene((prev) => {
        const next = new Set(prev);
        next.delete(sceneId);
        return next;
      });
    }
  }

  async function translateAll() {
    if (!language) return;
    setTranslatingAll(true);
    let ok = 0;
    let failed = 0;
    for (const scene of scenes) {
      try {
        await translateScene(scene.id);
        ok++;
      } catch {
        failed++;
      }
    }
    setTranslatingAll(false);
    toast.success(`Translated ${ok} scene(s) into ${language}.${failed ? ` ${failed} skipped/failed.` : ""}`);
  }

  async function saveSceneTranslation(sceneId: string, fields: { narration?: string | null }) {
    const res = await fetch(`/api/scenes/${sceneId}/translation`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, ...fields }),
    });
    if (!res.ok) {
      toast.error("Couldn't save translation.");
      return;
    }
    const data: { narration: string | null; narrationDeliveryNotes: string | null; narrationSpeed: number | null } = await res.json();
    setScenes((prev) =>
      prev.map((s) =>
        s.id === sceneId
          ? { ...s, translations: [...s.translations.filter((t) => t.language !== language), { language, ...data }] }
          : s
      )
    );
  }

  async function saveLineTranslation(sceneId: string, lineId: string, fields: { text?: string }) {
    const res = await fetch(`/api/dialogue-lines/${lineId}/translation`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, ...fields }),
    });
    if (!res.ok) {
      toast.error("Couldn't save translation.");
      return;
    }
    const data: { text: string; deliveryNotes: string | null; speed: number | null } = await res.json();
    setScenes((prev) =>
      prev.map((s) =>
        s.id === sceneId
          ? {
              ...s,
              dialogueLines: s.dialogueLines.map((l) =>
                l.id === lineId
                  ? { ...l, translations: [...l.translations.filter((t) => t.language !== language), { language, ...data }] }
                  : l
              ),
            }
          : s
      )
    );
  }

  async function saveNarratorVoice(voiceId: string) {
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ narratorVoiceForLanguage: { language, voiceId: voiceId || null } }),
    });
    if (!res.ok) {
      toast.error("Couldn't save narrator voice.");
      throw new Error();
    }
    setNarratorVoicesByLanguage((prev) => {
      const next = { ...prev };
      if (voiceId) next[language] = voiceId;
      else delete next[language];
      return next;
    });
    toast.success("Narrator voice saved.");
  }

  async function saveCharacterVoice(characterId: string, voiceId: string) {
    const res = await fetch(`/api/characters/${characterId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voiceForLanguage: { language, voiceId: voiceId || null } }),
    });
    if (!res.ok) {
      toast.error("Couldn't save voice.");
      throw new Error();
    }
    setCharacters((prev) =>
      prev.map((c) => {
        if (c.id !== characterId) return c;
        const next = { ...c.voicesByLanguage };
        if (voiceId) next[language] = voiceId;
        else delete next[language];
        return { ...c, voicesByLanguage: next };
      })
    );
    toast.success("Voice saved.");
  }

  async function generateNarrationAudio(sceneId: string) {
    setGeneratingNarration((prev) => new Set(prev).add(sceneId));
    try {
      const res = await fetch(`/api/scenes/${sceneId}/narration/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed.");
      setScenes((prev) =>
        prev.map((s) =>
          s.id === sceneId
            ? { ...s, narrationAudio: [data, ...s.narrationAudio.map((a) => (a.language === language ? { ...a, isSelected: false } : a))] }
            : s
        )
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Generation failed.");
    } finally {
      setGeneratingNarration((prev) => {
        const next = new Set(prev);
        next.delete(sceneId);
        return next;
      });
    }
  }

  async function generateLineAudio(sceneId: string, lineId: string) {
    setGeneratingLine((prev) => new Set(prev).add(lineId));
    try {
      const res = await fetch(`/api/dialogue-lines/${lineId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed.");
      setScenes((prev) =>
        prev.map((s) =>
          s.id === sceneId
            ? {
                ...s,
                dialogueLines: s.dialogueLines.map((l) =>
                  l.id === lineId
                    ? { ...l, audio: [data, ...l.audio.map((a) => (a.language === language ? { ...a, isSelected: false } : a))] }
                    : l
                ),
              }
            : s
        )
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Generation failed.");
    } finally {
      setGeneratingLine((prev) => {
        const next = new Set(prev);
        next.delete(lineId);
        return next;
      });
    }
  }

  async function selectTake(kind: "narration" | "line", sceneId: string, lineId: string | null, assetId: string) {
    const url =
      kind === "narration" ? `/api/scenes/${sceneId}/narration/${assetId}` : `/api/dialogue-lines/${lineId}/audio/${assetId}`;
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
      toast.error("Couldn't select take.");
      return;
    }
    setScenes((prev) =>
      prev.map((s) => {
        if (s.id !== sceneId) return s;
        if (kind === "narration") {
          return { ...s, narrationAudio: s.narrationAudio.map((a) => ({ ...a, isSelected: a.language === language ? a.id === assetId : a.isSelected })) };
        }
        return {
          ...s,
          dialogueLines: s.dialogueLines.map((l) =>
            l.id === lineId ? { ...l, audio: l.audio.map((a) => ({ ...a, isSelected: a.language === language ? a.id === assetId : a.isSelected })) } : l
          ),
        };
      })
    );
  }

  async function deleteTake(kind: "narration" | "line", sceneId: string, lineId: string | null, assetId: string) {
    const url =
      kind === "narration" ? `/api/scenes/${sceneId}/narration/${assetId}` : `/api/dialogue-lines/${lineId}/audio/${assetId}`;
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete take.");
      return;
    }
    setScenes((prev) =>
      prev.map((s) => {
        if (s.id !== sceneId) return s;
        if (kind === "narration") {
          return { ...s, narrationAudio: s.narrationAudio.filter((a) => a.id !== assetId) };
        }
        return {
          ...s,
          dialogueLines: s.dialogueLines.map((l) => (l.id === lineId ? { ...l, audio: l.audio.filter((a) => a.id !== assetId) } : l)),
        };
      })
    );
  }

  async function renderDub() {
    if (!language) return;
    setRendering(true);
    try {
      const base = parentType === "story" ? `/api/stories/${parentId}` : `/api/episodes/${parentId}`;
      const res = await fetch(`${base}/video/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: videoModelId || undefined, language }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Render failed.");
      // The server already deselected the previous same-language take —
      // mirror that here too, not just prepend, so the old take doesn't
      // keep showing as "Selected" until a reload (same pattern
      // VideoAssemblyPanel's generate() uses).
      setFinalVideos((prev) => [data, ...prev.map((v) => (v.language === language ? { ...v, isSelected: false } : v))]);
      toast.success(`Dubbed video rendered in ${language}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Render failed.");
    } finally {
      setRendering(false);
    }
  }

  async function selectFinalVideo(assetId: string) {
    const base = parentType === "story" ? `/api/stories/${parentId}` : `/api/episodes/${parentId}`;
    const res = await fetch(`${base}/video/${assetId}/select`, { method: "POST" });
    if (!res.ok) {
      toast.error("Couldn't select video.");
      return;
    }
    setFinalVideos((prev) => prev.map((v) => ({ ...v, isSelected: v.language === language ? v.id === assetId : v.isSelected })));
  }

  async function deleteFinalVideo(assetId: string) {
    const base = parentType === "story" ? `/api/stories/${parentId}` : `/api/episodes/${parentId}`;
    const res = await fetch(`${base}/video/${assetId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Couldn't delete video.");
      return;
    }
    setFinalVideos((prev) => prev.filter((v) => v.id !== assetId));
  }

  const dubVideos = finalVideos.filter((v) => v.language === language);

  if (targetLanguages.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          <Languages className="size-4" />
          Translations &amp; Dubbing
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Reuses the same visuals — translate the script, assign per-language voices, generate audio, then render a
          separate dubbed video. The project&apos;s own language ({primaryLanguage ?? "unset"}) is untouched.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-48">
            <Field label="Dub language">
              <Select value={language} onValueChange={(v) => v && setLanguage(v)} items={Object.fromEntries(targetLanguages.map((l) => [l, l]))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a language" />
                </SelectTrigger>
                <SelectContent>
                  {targetLanguages.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                      {existingLanguages.includes(l) ? " ✓" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {existingLanguages.length > 0 && (
            <p className="pb-2 text-xs text-muted-foreground">Already started: {existingLanguages.join(", ")}</p>
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-md border p-3">
          <Label className="text-xs text-muted-foreground">Narrator voice — {language}</Label>
          <VoiceSaveRow
            key={`narrator-${language}`}
            initialVoiceId={narratorVoicesByLanguage[language] ?? ""}
            language={language}
            onSave={saveNarratorVoice}
          />
          {characters.length > 0 && <Label className="mt-2 text-xs text-muted-foreground">Character voices — {language}</Label>}
          {characters.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-sm">{c.name}</span>
              <VoiceSaveRow
                key={`${c.id}-${language}`}
                initialVoiceId={c.voicesByLanguage[language] ?? ""}
                language={language}
                onSave={(voiceId) => saveCharacterVoice(c.id, voiceId)}
                className="flex-1"
              />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56">
            <Field label="Translation model">
              <ModelSelect jobType="TRANSLATION" value={translationModelId} onChange={setTranslationModelId} projectId={projectId} />
            </Field>
          </div>
          <Button onClick={translateAll} disabled={translatingAll || !language}>
            {translatingAll ? "Translating…" : `Translate all ${scenes.length} scene(s)`}
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          {scenes.map((scene) => {
            const st = sceneTranslation(scene);
            const takes = narrationTakes(scene);
            const isTranslating = translatingScene.has(scene.id);
            const isGeneratingNarration = generatingNarration.has(scene.id);
            return (
              <Collapsible key={scene.id} className="rounded-md border">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-2 text-left text-sm font-medium">
                  <span className="flex items-center gap-1.5">
                    <ChevronRight className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
                    Scene {scene.order}
                    {scene.title ? ` — ${scene.title}` : ""}
                  </span>
                  {st?.narration ? <Badge variant="secondary">Translated</Badge> : <Badge variant="outline">Not translated</Badge>}
                </CollapsibleTrigger>
                <CollapsiblePanel className="flex flex-col gap-3 border-t p-3">
                  {scene.narration && (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-muted-foreground">Narration — {language}</Label>
                        <Button size="sm" variant="outline" onClick={() => translateScene(scene.id)} disabled={isTranslating}>
                          {isTranslating ? "Translating…" : st ? "Retranslate" : "Translate"}
                        </Button>
                      </div>
                      <Textarea
                        rows={3}
                        value={st?.narration ?? ""}
                        onChange={(e) =>
                          setScenes((prev) =>
                            prev.map((s) =>
                              s.id === scene.id
                                ? {
                                    ...s,
                                    translations: [
                                      ...s.translations.filter((t) => t.language !== language),
                                      { language, narration: e.target.value, narrationDeliveryNotes: st?.narrationDeliveryNotes ?? null, narrationSpeed: st?.narrationSpeed ?? null },
                                    ],
                                  }
                                : s
                            )
                          )
                        }
                        onBlur={(e) => saveSceneTranslation(scene.id, { narration: e.target.value })}
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => generateNarrationAudio(scene.id)}
                          disabled={isGeneratingNarration || !st?.narration?.trim()}
                        >
                          {isGeneratingNarration ? "Generating…" : "Generate narration audio"}
                        </Button>
                      </div>
                      {takes.length > 0 && (
                        <div className="flex flex-col gap-1">
                          {takes.map((take) => (
                            <div key={take.id} className="flex items-center gap-2 rounded border p-1.5">
                              <audio controls src={take.url} className="h-8 flex-1" />
                              <Button
                                size="sm"
                                variant={take.isSelected ? "default" : "outline"}
                                onClick={() => selectTake("narration", scene.id, null, take.id)}
                              >
                                {take.isSelected ? "Selected" : "Select"}
                              </Button>
                              <Button size="icon-sm" variant="ghost" onClick={() => deleteTake("narration", scene.id, null, take.id)}>
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {scene.dialogueLines.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <Label className="text-xs text-muted-foreground">Dialogue — {language}</Label>
                      {scene.dialogueLines.map((line) => {
                        const lt = lineTranslation(line);
                        const lTakes = lineTakes(line);
                        const isGeneratingLine = generatingLine.has(line.id);
                        return (
                          <div key={line.id} className="flex flex-col gap-1.5 rounded border p-2">
                            <span className="text-xs font-medium text-muted-foreground">{line.character.name}</span>
                            <Textarea
                              rows={2}
                              value={lt?.text ?? ""}
                              placeholder={isTranslating ? "Translating…" : "Not translated yet"}
                              onChange={(e) =>
                                setScenes((prev) =>
                                  prev.map((s) =>
                                    s.id === scene.id
                                      ? {
                                          ...s,
                                          dialogueLines: s.dialogueLines.map((l) =>
                                            l.id === line.id
                                              ? {
                                                  ...l,
                                                  translations: [
                                                    ...l.translations.filter((t) => t.language !== language),
                                                    { language, text: e.target.value, deliveryNotes: lt?.deliveryNotes ?? null, speed: lt?.speed ?? null },
                                                  ],
                                                }
                                              : l
                                          ),
                                        }
                                      : s
                                  )
                                )
                              }
                              onBlur={(e) => saveLineTranslation(scene.id, line.id, { text: e.target.value })}
                            />
                            <div>
                              <Button
                                size="sm"
                                onClick={() => generateLineAudio(scene.id, line.id)}
                                disabled={isGeneratingLine || !lt?.text?.trim()}
                              >
                                {isGeneratingLine ? "Generating…" : "Generate line audio"}
                              </Button>
                            </div>
                            {lTakes.length > 0 && (
                              <div className="flex flex-col gap-1">
                                {lTakes.map((take) => (
                                  <div key={take.id} className="flex items-center gap-2 rounded border p-1.5">
                                    <audio controls src={take.url} className="h-8 flex-1" />
                                    <Button
                                      size="sm"
                                      variant={take.isSelected ? "default" : "outline"}
                                      onClick={() => selectTake("line", scene.id, line.id, take.id)}
                                    >
                                      {take.isSelected ? "Selected" : "Select"}
                                    </Button>
                                    <Button size="icon-sm" variant="ghost" onClick={() => deleteTake("line", scene.id, line.id, take.id)}>
                                      <Trash2 className="size-3.5" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!scene.narration && scene.dialogueLines.length === 0 && (
                    <p className="text-xs text-muted-foreground">This scene has no narration or dialogue to translate.</p>
                  )}
                </CollapsiblePanel>
              </Collapsible>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 rounded-md border p-3">
          <Label className="text-xs text-muted-foreground">Render dubbed video — {language}</Label>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-56">
              <Field label="Video model">
                <ModelSelect jobType="VIDEO" value={videoModelId} onChange={setVideoModelId} projectId={projectId} />
              </Field>
            </div>
            <Button onClick={renderDub} disabled={rendering || !language}>
              {rendering ? "Rendering…" : "Render dubbed video"}
            </Button>
          </div>
          {dubVideos.length > 0 && (
            <div className="flex flex-col gap-1">
              {dubVideos.map((v) => (
                <div key={v.id} className="flex items-center gap-2 rounded border p-1.5 text-sm">
                  <span className="flex-1 truncate">
                    {v.fileName} {v.sizeBytes ? `(${formatFileSize(v.sizeBytes)})` : ""}
                  </span>
                  <a href={v.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                    <Download className="size-3.5" />
                  </a>
                  <Button size="sm" variant={v.isSelected ? "default" : "outline"} onClick={() => selectFinalVideo(v.id)}>
                    {v.isSelected ? "Selected" : "Select"}
                  </Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => deleteFinalVideo(v.id)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
