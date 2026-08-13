"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Save, Trash2 } from "lucide-react";

interface LocationFields {
  name: string;
  description: string;
  architecture: string;
  environment: string;
  timeWeather: string;
  visualStyle: string;
}

export function LocationDetailForm({
  locationId,
  initialFields,
}: {
  locationId: string;
  initialFields: LocationFields;
}) {
  const router = useRouter();
  const [fields, setFields] = useState(initialFields);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function update<K extends keyof LocationFields>(key: K, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/locations/${locationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error();
      toast.success("Location saved.");
      router.refresh();
    } catch {
      toast.error("Couldn't save location.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${fields.name}"? This can't be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/locations/${locationId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      router.back();
      router.refresh();
    } catch {
      toast.error("Couldn't delete location.");
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Name">
        <Input value={fields.name} onChange={(e) => update("name", e.target.value)} />
      </Field>
      <Field label="Description">
        <Textarea
          rows={3}
          value={fields.description}
          onChange={(e) => update("description", e.target.value)}
        />
      </Field>
      <Field label="Architecture">
        <Textarea
          rows={2}
          value={fields.architecture}
          onChange={(e) => update("architecture", e.target.value)}
        />
      </Field>
      <Field label="Environment">
        <Textarea
          rows={2}
          value={fields.environment}
          onChange={(e) => update("environment", e.target.value)}
        />
      </Field>
      <Field label="Time / Weather">
        <Input value={fields.timeWeather} onChange={(e) => update("timeWeather", e.target.value)} />
      </Field>
      <Field label="Visual style">
        <Textarea
          rows={2}
          value={fields.visualStyle}
          onChange={(e) => update("visualStyle", e.target.value)}
        />
      </Field>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={saving}>
          <Save className="size-4" />
          {saving ? "Saving…" : "Save Location"}
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
