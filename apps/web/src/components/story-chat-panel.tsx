"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelect } from "@/components/model-select";
import { Send, Plus } from "lucide-react";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

type ApplyTarget = { kind: "story"; projectId: string } | { kind: "episode"; episodeId: string };

// Story Chat — converse about the current Story/Episode (Context Engine
// supplies the system context server-side), then optionally apply an
// assistant reply onto the actual Story content / Episode summary. History
// lives only in this component's state and is resent each turn; nothing is
// persisted server-side (see api/projects/[id]/story-chat/route.ts).
export function StoryChatPanel({
  projectId,
  episodeId,
  applyTarget,
  applyLabel,
  initialContent,
}: {
  projectId: string;
  episodeId?: string;
  applyTarget: ApplyTarget;
  applyLabel: string;
  initialContent: string;
}) {
  const [modelId, setModelId] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [content, setContent] = useState(initialContent);
  const [applyingIndex, setApplyingIndex] = useState<number | null>(null);

  async function send() {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setDraft("");
    const nextTurns: ChatTurn[] = [...turns, { role: "user", content: message }];
    setTurns(nextTurns);

    try {
      const res = await fetch(`/api/projects/${projectId}/story-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: modelId || undefined, episodeId, history: turns, message }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Chat request failed");
      }
      const { reply } = await res.json();
      setTurns([...nextTurns, { role: "assistant", content: reply }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Chat request failed.");
      setTurns(turns);
      setDraft(message);
    } finally {
      setSending(false);
    }
  }

  async function applyReply(index: number, reply: string) {
    setApplyingIndex(index);
    const nextContent = content ? `${content}\n\n${reply}` : reply;
    try {
      const res =
        applyTarget.kind === "story"
          ? await fetch(`/api/projects/${applyTarget.projectId}/story/content`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: nextContent }),
            })
          : await fetch(`/api/episodes/${applyTarget.episodeId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ summary: nextContent }),
            });
      if (!res.ok) throw new Error();
      setContent(nextContent);
      toast.success(`Added to ${applyLabel}. Reloading to show it in the editor…`);
      // The Story/Episode editor and Versions panel are separate client
      // components that only read their initial value from server props —
      // they have no way to see this PATCH. A full reload is the simplest
      // way to keep every panel in sync without wiring cross-component state.
      setTimeout(() => window.location.reload(), 800);
    } catch {
      toast.error(`Couldn't add to ${applyLabel}.`);
    } finally {
      setApplyingIndex(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ModelSelect jobType="STORY_CHAT" value={modelId} onChange={setModelId} />

      <div className="flex max-h-96 flex-col gap-3 overflow-y-auto rounded-md border p-3">
        {turns.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Brainstorm, ask continuity questions, or paste in dialogue/narration for feedback — the
            Story/Episode context is already included automatically.
          </p>
        )}
        {turns.map((turn, i) => (
          <div key={i} className={turn.role === "user" ? "self-end text-right" : "self-start"}>
            <div
              className={
                turn.role === "user"
                  ? "inline-block rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                  : "inline-block rounded-md bg-muted px-3 py-2 text-sm"
              }
            >
              <p className="whitespace-pre-wrap text-left">{turn.content}</p>
            </div>
            {turn.role === "assistant" && (
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={applyingIndex === i}
                  onClick={() => applyReply(i, turn.content)}
                  className="mt-1"
                >
                  <Plus className="size-3.5" />
                  {applyingIndex === i ? "Adding…" : `Add to ${applyLabel}`}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask, brainstorm, or paste text for feedback…"
          className="min-h-16"
        />
        <Button onClick={send} disabled={sending || !draft.trim()}>
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}
