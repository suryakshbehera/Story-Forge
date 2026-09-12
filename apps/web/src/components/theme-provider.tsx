"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

// Thin re-export so layout.tsx (a Server Component) can render this without
// needing its own "use client" boundary — next-themes' provider is already
// a client component internally, this just gives it a project-local home.
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
