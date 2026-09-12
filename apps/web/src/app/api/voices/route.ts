import { NextResponse } from "next/server";
import { listVoices, ElevenLabsError } from "@/lib/ai/elevenlabs";
import { SARVAM_SPEAKERS } from "@/lib/ai/sarvam";

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
export async function GET() {
  const sarvamVoices: VoiceCatalogEntry[] = SARVAM_SPEAKERS.map((s) => ({
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
