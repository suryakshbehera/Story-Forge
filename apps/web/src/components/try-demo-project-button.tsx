"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

// Every click creates a fresh, independent demo project for this user —
// deliberately not a shared/global seed row, and nothing fires until the
// user asks for it (no auto-running generation on signup).
export function TryDemoProjectButton() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function handleClick() {
    setCreating(true);
    try {
      const res = await fetch("/api/projects/demo", { method: "POST" });
      if (!res.ok) throw new Error();
      const project = await res.json();
      router.push(`/projects/${project.id}`);
      router.refresh();
    } catch {
      toast.error("Couldn't create the demo project.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Button variant="outline" onClick={handleClick} disabled={creating}>
      <Sparkles className="size-4" />
      {creating ? "Creating…" : "Try a demo project"}
    </Button>
  );
}
