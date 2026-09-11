import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

// Puts the explanation next to the term itself, reachable before the user
// acts on it — not just an always-on paragraph underneath that only makes
// sense in hindsight. Trigger is a real <button> (Base UI default), so it
// opens on keyboard focus as well as hover/click, not hover-only.
export function TermHint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" aria-label="What does this mean?" className="text-muted-foreground hover:text-foreground" />}
      >
        <HelpCircle className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}
