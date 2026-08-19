import Link from "next/link";
import { Settings, Users } from "lucide-react";
import { getCurrentUserDetail } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";

export async function SiteHeader() {
  const user = await getCurrentUserDetail();

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="font-semibold tracking-tight">
          Narrata
        </Link>
        <div className="flex items-center gap-4">
          {user?.role === "ADMIN" && (
            <>
              <Link
                href="/settings/ai-models"
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <Settings className="size-4" />
                AI Models
              </Link>
              <Link
                href="/settings/people"
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <Users className="size-4" />
                People
              </Link>
            </>
          )}
          {user && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{user.email}</span>
              <LogoutButton />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
