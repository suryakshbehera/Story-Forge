"use client";

import { Button } from "@/components/ui/button";

export default function ProjectError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3 py-12">
      <h2 className="text-lg font-semibold">Something went wrong.</h2>
      <p className="text-sm text-muted-foreground">
        {error.digest ? `Error reference: ${error.digest}` : "This page hit an unexpected error."}
      </p>
      <Button onClick={() => retry()}>Try again</Button>
    </div>
  );
}
