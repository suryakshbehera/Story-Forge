"use client";

// global-error replaces the root layout entirely when it fires, so it can't
// rely on globals.css/Tailwind or the app's theme tokens — kept to plain
// inline styles deliberately, not an oversight.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html>
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: "0.75rem",
          padding: "3rem",
          color: "#111",
          background: "#fff",
        }}
      >
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Something went wrong.</h2>
        <p style={{ fontSize: "0.875rem", color: "#555", margin: 0 }}>
          {error.digest ? `Error reference: ${error.digest}` : "The app hit an unexpected error."}
        </p>
        <button
          onClick={() => retry()}
          style={{
            padding: "0.4rem 0.9rem",
            borderRadius: "0.5rem",
            border: "1px solid #ccc",
            background: "#f5f5f5",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
