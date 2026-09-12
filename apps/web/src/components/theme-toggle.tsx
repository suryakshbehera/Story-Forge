"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // Avoids a hydration mismatch: resolvedTheme is only known client-side
  // (it depends on the OS preference under "system"), so the icon renders
  // nothing until after mount rather than guessing and flipping.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Standard next-themes hydration-safe idiom: resolvedTheme is only
    // known after the client mounts (it depends on a script that runs
    // before hydration), so this one-time flip is deliberate, not a
    // synchronization bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) return <div className="size-7" />;

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
