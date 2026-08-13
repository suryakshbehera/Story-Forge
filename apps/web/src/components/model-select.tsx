"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AiJobType } from "db";

interface ModelOption {
  id: string;
  displayName: string;
  modelId: string;
  isDefault: boolean;
}

export function ModelSelect({
  jobType,
  value,
  onChange,
}: {
  jobType: AiJobType;
  // Always a defined string ("" = nothing selected yet) — Base UI's Select
  // treats the value as controlled from the very first render it sees a
  // non-undefined value, and warns/breaks if it later flips from
  // uncontrolled (undefined) to controlled once the default model loads.
  value: string;
  onChange: (modelId: string) => void;
}) {
  const [models, setModels] = useState<ModelOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ai-models?jobType=${jobType}&enabledOnly=true`)
      .then((res) => res.json())
      .then((data: ModelOption[]) => {
        if (cancelled) return;
        setModels(data);
        if (!value) {
          const fallback = data.find((m) => m.isDefault) ?? data[0];
          if (fallback) onChange(fallback.id);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobType]);

  if (models !== null && models.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No models configured for this job. Add one in{" "}
        <a href="/settings/ai-models" className="underline">
          Settings → AI Models
        </a>
        .
      </p>
    );
  }

  // Base UI's Select only knows an item's label from <Select.Item> children
  // once the popup has mounted at least once — until then the trigger shows
  // the raw value. Passing `items` lets it resolve the label immediately,
  // so a pre-selected default shows "Claude Sonnet 5", not its raw id.
  const items = Object.fromEntries(
    (models ?? []).map((model) => [model.id, `${model.displayName}${model.isDefault ? " (default)" : ""}`])
  );

  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)} items={items}>
      <SelectTrigger className="w-full sm:w-64">
        <SelectValue placeholder={models === null ? "Loading models…" : "Select a model"} />
      </SelectTrigger>
      <SelectContent>
        {(models ?? []).map((model) => (
          <SelectItem key={model.id} value={model.id}>
            {model.displayName}
            {model.isDefault ? " (default)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
