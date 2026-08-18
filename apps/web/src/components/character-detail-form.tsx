"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Save, Trash2, Lock } from "lucide-react";

interface CharacterFields {
  name: string;
  identity: string;
  appearance: string;
  personality: string;
  clothing: string;
  background: string;
  characterArc: string;
  isLocked: boolean;
  voiceName: string;
}

export function CharacterDetailForm({
  characterId,
  initialFields,
}: {
  characterId: string;
  initialFields: CharacterFields;
}) {
  const router = useRouter();
  const [fields, setFields] = useState(initialFields);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function update<K extends keyof CharacterFields>(key: K, value: CharacterFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/characters/${characterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error();
      toast.success("Character saved.");
      router.refresh();
    } catch {
      toast.error("Couldn't save character.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${fields.name}"? This can't be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/characters/${characterId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      router.back();
      router.refresh();
    } catch {
      toast.error("Couldn't delete character.");
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <div className="grid flex-1 gap-1.5">
          <Label className="text-xs text-muted-foreground">Name</Label>
          <Input value={fields.name} onChange={(e) => update("name", e.target.value)} />
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-sm">
          <Lock className="size-3.5 text-muted-foreground" />
          Lock
          <Switch checked={fields.isLocked} onCheckedChange={(v) => update("isLocked", v)} />
        </label>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        Locked characters are always included in the Context Engine, so they stay visually and
        narratively consistent across every generation.
      </p>

      <Field label="Identity">
        <Textarea rows={2} value={fields.identity} onChange={(e) => update("identity", e.target.value)} />
      </Field>
      <Field label="Appearance">
        <Textarea
          rows={3}
          value={fields.appearance}
          onChange={(e) => update("appearance", e.target.value)}
        />
      </Field>
      <Field label="Personality">
        <Textarea
          rows={2}
          value={fields.personality}
          onChange={(e) => update("personality", e.target.value)}
        />
      </Field>
      <Field label="Clothing">
        <Textarea rows={2} value={fields.clothing} onChange={(e) => update("clothing", e.target.value)} />
      </Field>
      <Field label="Background">
        <Textarea
          rows={2}
          value={fields.background}
          onChange={(e) => update("background", e.target.value)}
        />
      </Field>
      <Field label="Character arc">
        <Textarea
          rows={2}
          value={fields.characterArc}
          onChange={(e) => update("characterArc", e.target.value)}
        />
      </Field>
      <Field label={`Voice (ElevenLabs voice ID, or Sarvam speaker name e.g. "shubh" — must match whichever provider you pick when generating)`}>
        <Input value={fields.voiceName} onChange={(e) => update("voiceName", e.target.value)} />
      </Field>
      <p className="-mt-2 text-xs text-muted-foreground">
        Used for every dialogue line this character speaks, in every scene — set it once here so the
        character sounds consistent across the whole story.
      </p>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={saving}>
          <Save className="size-4" />
          {saving ? "Saving…" : "Save Character"}
        </Button>
        <Button onClick={remove} disabled={deleting} variant="outline" className="text-destructive">
          <Trash2 className="size-4" />
          Delete
        </Button>
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
