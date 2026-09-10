import { Card, CardContent, CardHeader } from "@/components/ui/card";

// Same reasoning as story/scenes/loading.tsx — episode pages join the same
// heavy scene data plus context-assembly and episode video state.
export default function EpisodeLoading() {
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <div className="h-5 w-1/3 animate-pulse rounded bg-muted" />
        </CardHeader>
        <CardContent>
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
      {[0, 1, 2].map((i) => (
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
