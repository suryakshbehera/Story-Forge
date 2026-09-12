import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export interface GenerationErrorInfo {
  message: string;
  modelId?: string;
  provider?: string;
}

// Problem → Explanation → Action, inline where the failed attempt actually
// happened — replaces a toast as the *only* signal (the toast still fires
// too, this is the part that doesn't vanish in a few seconds).
export function GenerationErrorBanner({
  error,
  onRetry,
  onDismiss,
}: {
  error: GenerationErrorInfo;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="flex-1">
        <p className="font-medium text-destructive">Generation failed</p>
        <p className="text-xs text-muted-foreground">
          {error.message}
          {error.provider && error.modelId ? ` — via ${error.provider} · ${error.modelId}` : ""}
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <Button size="xs" variant="outline" onClick={onRetry}>
            Retry
          </Button>
          <Button size="xs" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}
