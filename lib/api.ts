import { supabase, SUPABASE_KEY, SUPABASE_URL } from "./supabase";
import type { Book } from "./types";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

async function accessToken(): Promise<string> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("unauthorized", "Not signed in", 401);
  return token;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!API_URL) throw new ApiError("api_not_configured", "NEXT_PUBLIC_API_URL is not set");
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("network", "Network error");
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = json?.detail;
    throw new ApiError(detail?.code ?? "http_error", detail?.message ?? res.statusText, res.status);
  }
  return json as T;
}

export const api = {
  createBook: (body: { source_path: string; filename: string; title?: string; language?: string; voice?: string }) =>
    call<Book>("POST", "/books", body),
  renameBook: (id: string, title: string) => call<Book>("PATCH", `/books/${id}`, { title }),
  retryBook: (id: string) => call<{ ok: true }>("POST", `/books/${id}/retry`),
  cancelBook: (id: string) => call<{ ok: true }>("POST", `/books/${id}/cancel`),
  deleteBook: (id: string) => call<void>("DELETE", `/books/${id}`),
};

/** Upload straight to Supabase Storage with real progress (supabase-js has no progress events). */
export async function uploadSource(
  file: File,
  path: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = await accessToken();
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SUPABASE_URL}/storage/v1/object/uploads/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", SUPABASE_KEY);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = xhr.statusText;
      try {
        message = JSON.parse(xhr.responseText).message ?? message;
      } catch {
        /* keep statusText */
      }
      reject(new ApiError(xhr.status === 413 ? "file_too_large" : "upload_failed", message, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("network", "Network error"));
    xhr.onabort = () => reject(new ApiError("aborted", "Upload cancelled"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}
