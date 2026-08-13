import { prisma } from "@/lib/db";

interface AssembleContextParams {
  projectId: string;
  episodeId?: string;
}

const MAX_CHARS = 60000;

function section(title: string, lines: Array<string | null | undefined | false>): string | null {
  const body = lines.filter((line): line is string => Boolean(line)).join("\n");
  return body ? `## ${title}\n${body}` : null;
}

// Rule-based context assembly for V1 — no vector search. Pulls Story/Story
// Bible core fields, all locked Characters, Locations, and (for series)
// prior episode summaries, then trims to a character budget. This is what
// "Generate Story" and later generation actions send as Project Context.
export async function assembleContext({ projectId, episodeId }: AssembleContextParams): Promise<string> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { story: true, storyBible: true },
  });

  const sections: string[] = [
    `Project: ${project.name} (${project.type === "SINGLE" ? "Single Video" : "Series"})`,
  ];

  if (project.story) {
    const s = project.story;
    const storySection = section("Story", [
      s.topic && `Topic: ${s.topic}`,
      s.premise && `Premise: ${s.premise}`,
      s.genre && `Genre: ${s.genre}`,
      s.tone && `Tone: ${s.tone}`,
      s.language && `Language: ${s.language}`,
      s.duration && `Target duration: ${s.duration}`,
      s.narrationStyle && `Narration style: ${s.narrationStyle}`,
      s.openingStyle && `Opening style: ${s.openingStyle}`,
      s.closingStyle && `Closing style: ${s.closingStyle}`,
    ]);
    if (storySection) sections.push(storySection);
  }

  if (project.storyBible) {
    const b = project.storyBible;
    const bibleSection = section("Story Bible", [
      b.premise && `Premise: ${b.premise}`,
      b.genre && `Genre: ${b.genre}`,
      b.tone && `Tone: ${b.tone}`,
      b.language && `Language: ${b.language}`,
      b.worldRules && `World rules: ${b.worldRules}`,
      b.visualStyle && `Visual style: ${b.visualStyle}`,
      b.timelineNotes && `Timeline notes: ${b.timelineNotes}`,
    ]);
    if (bibleSection) sections.push(bibleSection);
  }

  // Locked characters are always in context regardless of relevance
  // heuristics — that's what "Lock Character" is for. Non-locked characters
  // are left out of V1's automatic context; explicit per-scene tagging
  // arrives with the Scene Engine (Phase 2).
  const characters = await prisma.character.findMany({
    where: { projectId, isLocked: true },
    orderBy: { name: "asc" },
  });
  if (characters.length > 0) {
    const characterBlocks = characters
      .map((c) =>
        [
          `### ${c.name}`,
          c.identity && `Identity: ${c.identity}`,
          c.appearance && `Appearance: ${c.appearance}`,
          c.personality && `Personality: ${c.personality}`,
          c.clothing && `Clothing: ${c.clothing}`,
          c.background && `Background: ${c.background}`,
          c.characterArc && `Arc: ${c.characterArc}`,
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n\n");
    sections.push(`## Locked Characters (must stay consistent)\n${characterBlocks}`);
  }

  const locations = await prisma.location.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
  });
  if (locations.length > 0) {
    const locationBlocks = locations
      .map((l) =>
        [
          `### ${l.name}`,
          l.description && `Description: ${l.description}`,
          l.architecture && `Architecture: ${l.architecture}`,
          l.environment && `Environment: ${l.environment}`,
          l.timeWeather && `Time/Weather: ${l.timeWeather}`,
          l.visualStyle && `Visual style: ${l.visualStyle}`,
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n\n");
    sections.push(`## Locations\n${locationBlocks}`);
  }

  if (episodeId) {
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      include: { season: true },
    });

    if (episode) {
      const priorEpisodes = await prisma.episode.findMany({
        where: {
          season: { projectId },
          OR: [
            { season: { number: { lt: episode.season.number } } },
            { season: { number: episode.season.number }, number: { lt: episode.number } },
          ],
        },
        include: { season: true },
        orderBy: [{ season: { number: "asc" } }, { number: "asc" }],
      });

      const summarized = priorEpisodes.filter((e) => e.summary);
      if (summarized.length > 0) {
        const lines = summarized.map(
          (e) => `S${e.season.number}E${e.number}${e.title ? ` — ${e.title}` : ""}: ${e.summary}`
        );
        sections.push(`## Previous Episode Summaries\n${lines.join("\n")}`);
      }

      const currentSection = section("Current Episode", [
        `S${episode.season.number}E${episode.number}${episode.title ? ` — ${episode.title}` : ""}`,
        episode.summary && `Summary so far: ${episode.summary}`,
      ]);
      if (currentSection) sections.push(currentSection);
    }
  }

  // Full written content is appended last, after all short structural
  // metadata (characters, locations, episode summaries) — so if MAX_CHARS
  // truncation kicks in, the compact context survives and only the
  // long-form prose gets cut. Story writing itself doesn't need this (it's
  // generating content, not consuming it), but Scene Engine does — it
  // breaks the actual prose into scenes.
  if (project.story?.content) {
    sections.push(`## Full Story Content\n${project.story.content}`);
  }
  if (project.storyBible?.content) {
    sections.push(`## Full Story Bible Content\n${project.storyBible.content}`);
  }

  const fullContext = sections.join("\n\n");

  if (fullContext.length > MAX_CHARS) {
    return `${fullContext.slice(0, MAX_CHARS)}\n\n[...context truncated to fit budget...]`;
  }

  return fullContext;
}
