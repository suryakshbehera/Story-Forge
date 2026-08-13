import Link from "next/link";
import { Settings } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="font-semibold tracking-tight">
          Narrata
        </Link>
        <Link
          href="/settings/ai-models"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <Settings className="size-4" />
          AI Models
        </Link>
      </div>
    </header>
  );
}
