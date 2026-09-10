import { Card, CardContent, CardHeader } from "@/components/ui/card";

// Scene rows are the heaviest fetch in the app (shots+images, dialogue+audio,
// video clips, audio takes all joined per scene) — a few scene-shaped
// skeletons read as more specific/meaningful here than the generic
// projects/[id]/loading.tsx fallback.
export default function ScenesLoading() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="h-4 w-8 animate-pulse rounded bg-muted" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <div className="h-24 w-40 animate-pulse rounded bg-muted" />
              <div className="h-24 w-40 animate-pulse rounded bg-muted" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
