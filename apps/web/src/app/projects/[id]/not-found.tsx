import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ProjectNotFound() {
  return (
    <div className="flex flex-col items-start gap-3 py-12">
      <h2 className="text-lg font-semibold">We couldn&apos;t find that.</h2>
      <p className="text-sm text-muted-foreground">
        This project, scene, or item doesn&apos;t exist, or it may have been deleted.
      </p>
      <Button render={<Link href="/" />}>Back to all projects</Button>
    </div>
  );
}
