import { useCallback } from "react";
import { useAuth } from "./auth";
import { API_BASE_URL } from "./config";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Bound to the current session token — every mobile screen's data comes through this, never a raw fetch(). */
export function useApiFetch() {
  const { token } = useAuth();

  return useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
      if (token) headers.Authorization = `Bearer ${token}`;
      // FormData must NOT get an explicit Content-Type — fetch sets its own
      // multipart boundary parameter, and overriding it breaks the upload
      // silently (the server can't find the boundary and fails to parse).
      const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
      if (init?.body && !isFormData && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

      const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new ApiError((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`, res.status);
      }
      return body as T;
    },
    [token]
  );
}
