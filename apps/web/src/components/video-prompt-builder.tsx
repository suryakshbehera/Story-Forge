import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Originally Seedance-specific (seedance-studio.tsx); generalized here so
// scene-video-panel.tsx can offer the same structured prompt mode for any
// video model, not just one named route — Phase 13. The technique itself
// isn't model-specific: "direct the scene, don't describe an image" and
// timed beats as in-prompt plain text (no model has a real timestamp field)
// apply equally to any IMAGE_TO_VIDEO/TEXT_TO_VIDEO generation call.
export interface PromptBuilderFields {
  subject: string;
  action: string;
  camera: string;
  style: string;
  beatHook: string;
  beatDevelopment: string;
  beatEscalation: string;
  beatResolution: string;
  ending: string;
}

export const EMPTY_PROMPT_BUILDER_FIELDS: PromptBuilderFields = {
  subject: "",
  action: "",
  camera: "",
  style: "",
  beatHook: "",
  beatDevelopment: "",
  beatEscalation: "",
  beatResolution: "",
  ending: "",
};

export function assembleVideoPrompt(f: PromptBuilderFields): string {
  const lines: string[] = [];
  const core = [f.subject.trim(), f.action.trim()].filter(Boolean).join(" ");
  if (core) lines.push(core);
  if (f.camera.trim()) lines.push(`Camera: ${f.camera.trim()}.`);
  if (f.style.trim()) lines.push(`Style: ${f.style.trim()}.`);
  const beats = [
    f.beatHook.trim() && `0-5s: ${f.beatHook.trim()}.`,
    f.beatDevelopment.trim() && `5-16s: ${f.beatDevelopment.trim()}.`,
    f.beatEscalation.trim() && `16-25s: ${f.beatEscalation.trim()}.`,
    f.beatResolution.trim() && `25-30s: ${f.beatResolution.trim()}.`,
  ].filter((b): b is string => Boolean(b));
  if (beats.length) lines.push(`Timeline — ${beats.join(" ")}`);
  if (f.ending.trim()) lines.push(`End on: ${f.ending.trim()}.`);
  return lines.join("\n\n");
}

export const VIDEO_PROMPT_FAILURE_MODES: { symptom: string; fix: string }[] = [
  { symptom: "Character/outfit drifts mid-clip", fix: "Keep the scene to 8 or fewer identifiable people; lock “must not change” details in Style." },
  { symptom: "Camera wanders aimlessly", fix: "Name one explicit move in Camera instead of leaving it blank." },
  { symptom: "Reactions/events feel jumbled", fix: "Fill in the timed beats so cause is stated before effect." },
  { symptom: "Clip trails off with no resolution", fix: "Fill in “Ending” — a held frame, pull-back, or specific gesture." },
];

export function PromptBuilderFieldsForm({
  fields,
  onChange,
  assembled,
  savedPrompt,
}: {
  fields: PromptBuilderFields;
  onChange: (fields: PromptBuilderFields) => void;
  assembled: string;
  savedPrompt?: string | null;
}) {
  function set<K extends keyof PromptBuilderFields>(key: K, value: string) {
    onChange({ ...fields, [key]: value });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Direct the scene, don&apos;t describe an image — Subject → Action → Camera → Style, in playback order.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs text-muted-foreground">Subject</Label>
          <Textarea rows={2} placeholder="e.g. A woman in a red coat" value={fields.subject} onChange={(e) => set("subject", e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Action</Label>
          <Textarea
            rows={2}
            placeholder="e.g. walks briskly through falling snow, glancing over her shoulder"
            value={fields.action}
            onChange={(e) => set("action", e.target.value)}
            className="mt-1.5"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Camera</Label>
          <Input placeholder="e.g. slow dolly-in from a low angle" value={fields.camera} onChange={(e) => set("camera", e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Style</Label>
          <Input
            placeholder="e.g. cinematic, moody blue-hour lighting, shallow depth of field"
            value={fields.style}
            onChange={(e) => set("style", e.target.value)}
            className="mt-1.5"
          />
        </div>
      </div>

      <details className="rounded-md border p-2.5">
        <summary className="cursor-pointer text-sm font-medium">Timed beats (optional — for longer clips)</summary>
        <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground">Hook (0–5s)</Label>
            <Textarea rows={2} value={fields.beatHook} onChange={(e) => set("beatHook", e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Development (5–16s)</Label>
            <Textarea rows={2} value={fields.beatDevelopment} onChange={(e) => set("beatDevelopment", e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Escalation / proof (16–25s)</Label>
            <Textarea rows={2} value={fields.beatEscalation} onChange={(e) => set("beatEscalation", e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Resolution (25–30s)</Label>
            <Textarea rows={2} value={fields.beatResolution} onChange={(e) => set("beatResolution", e.target.value)} className="mt-1.5" />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Planning aids, not frame-exact contracts — most video models have no separate timestamp field, so these are written into the
          prompt as plain timed stage directions.
        </p>
      </details>

      <div>
        <Label className="text-xs text-muted-foreground">Ending (always direct how it ends)</Label>
        <Input
          placeholder="e.g. she stops, turns to face camera, hold on her expression"
          value={fields.ending}
          onChange={(e) => set("ending", e.target.value)}
          className="mt-1.5"
        />
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">Assembled prompt (what actually gets sent)</Label>
        <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2.5 text-xs">
          {assembled || "(blank — falls back to the scene description at generation time)"}
        </pre>
      </div>

      {savedPrompt && (
        <p className="text-xs text-muted-foreground">
          Currently saved on this scene: <span className="italic">&quot;{savedPrompt}&quot;</span> — generating replaces it with the
          assembled prompt above.
        </p>
      )}
    </div>
  );
}

export function VideoPromptTroubleshooting() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Symptom</TableHead>
          <TableHead>Likely fix</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {VIDEO_PROMPT_FAILURE_MODES.map((row) => (
          <TableRow key={row.symptom}>
            <TableCell className="whitespace-normal text-sm">{row.symptom}</TableCell>
            <TableCell className="whitespace-normal text-sm text-muted-foreground">{row.fix}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
