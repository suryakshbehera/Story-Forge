"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INDIAN_LANGUAGES } from "@/lib/languages";

export function LanguageSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const items = Object.fromEntries(INDIAN_LANGUAGES.map((lang) => [lang, lang]));

  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)} items={items}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select a language" />
      </SelectTrigger>
      <SelectContent>
        {INDIAN_LANGUAGES.map((lang) => (
          <SelectItem key={lang} value={lang}>
            {lang}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
