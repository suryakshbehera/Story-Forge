import { NextResponse } from "next/server";
import { listVoices, ElevenLabsError } from "@/lib/ai/elevenlabs";
import { SARVAM_SPEAKERS } from "@/lib/ai/sarvam";
import { sarvamLanguageCode } from "@/lib/languages";

export interface VoiceCatalogEntry {
  provider: "elevenlabs" | "sarvam";
  voiceId: string;
  name: string;
  description: string | null;
  previewUrl: string | null;
}

// Both catalogs in one response — the picker doesn't know in advance which
// provider a project/character will end up using (voiceId is free text,
// resolved against whichever provider is picked at generation time, per
// lib/voice.ts), so it needs both lists to search/filter across.
//
// Optional `?language=` narrows the Sarvam half: every Sarvam speaker works
// across all its supported languages via the language_code param (not a
// per-speaker trait, see ai/sarvam.ts), so a language Sarvam's fixed 11
// doesn't cover means none of its speakers would actually work — hiding the
// whole list rather than any specific voice. ElevenLabs voices aren't
// filtered here: its language coverage is a per-*model* property (see
// lib/languages.ts's elevenLabsLanguageSupported, enforced at generation
// time in lib/voice.ts), not a per-voice one, so no voice in this list can
// be ruled out just from the language alone.
export async function GET(request: Request) {
  const language = new URL(request.url).searchParams.get("language");
  const sarvamUsable = !language || sarvamLanguageCode(language) !== null;

  const sarvamVoices: VoiceCatalogEntry[] = !sarvamUsable
    ? []
    : SARVAM_SPEAKERS.map((s) => ({
        provider: "sarvam",
        voiceId: s.voiceId,
        name: `${s.voiceId[0].toUpperCase()}${s.voiceId.slice(1)} (${s.gender})`,
        description: null,
        previewUrl: null,
      }));

  try {
    const elevenLabsVoices: VoiceCatalogEntry[] = (await listVoices()).map((v) => ({
      provider: "elevenlabs",
      voiceId: v.voiceId,
      name: v.name,
      description: [v.gender, v.accent, v.language].filter(Boolean).join(" · ") || v.description,
      previewUrl: v.previewUrl,
    }));
    return NextResponse.json({ voices: [...elevenLabsVoices, ...sarvamVoices] });
  } catch (error) {
    // ElevenLabs being unreachable/unconfigured shouldn't take Sarvam's
    // (static, always-available) list down with it.
    if (error instanceof ElevenLabsError) {
      return NextResponse.json({ voices: sarvamVoices, elevenLabsError: error.message });
    }
    throw error;
  }
}
