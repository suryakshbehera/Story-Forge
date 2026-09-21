import Link from "next/link";
import { Download, Settings, Users } from "lucide-react";
import { getCurrentUserDetail } from "@/lib/auth";
import { APP_DOWNLOAD_URL } from "@/lib/app-download";
import { LogoutButton } from "@/components/logout-button";
import { JobTray } from "@/components/job-tray";
import { ThemeToggle } from "@/components/theme-toggle";

export async function SiteHeader() {
  const user = await getCurrentUserDetail();

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4">
        <Link href="/" className="shrink-0 font-semibold tracking-tight">
          Narrata
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <JobTray />
          <ThemeToggle />
          <a
            href={APP_DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Download the app"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <Download className="size-4" />
            <span className="hidden sm:inline">Get the app</span>
          </a>
          {user?.role === "ADMIN" && (
            <>
              <Link
                href="/settings/ai-models"
                aria-label="AI Models"
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <Settings className="size-4" />
                <span className="hidden sm:inline">AI Models</span>
              </Link>
              <Link
                href="/settings/people"
                aria-label="People"
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <Users className="size-4" />
                <span className="hidden sm:inline">People</span>
              </Link>
            </>
          )}
          {user && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="hidden sm:inline">{user.email}</span>
              <LogoutButton />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
