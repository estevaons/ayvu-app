import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { kv } from "./platform";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        storage: {
          getItem: (key) => kv.get(key),
          setItem: (key, value) => kv.set(key, value),
          removeItem: (key) => kv.remove(key),
        },
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
  }
  return client;
}

// Signed URLs are cached per path until shortly before they expire.
const signedCache = new Map<string, { url: string; expires: number }>();
const SIGNED_TTL = 60 * 60 * 6;

export async function signedUrl(bucket: "audio" | "covers", path: string): Promise<string | null> {
  const key = `${bucket}/${path}`;
  const hit = signedCache.get(key);
  if (hit && hit.expires > Date.now() + 60_000) return hit.url;
  const { data, error } = await supabase().storage.from(bucket).createSignedUrl(path, SIGNED_TTL);
  if (error || !data) return null;
  signedCache.set(key, { url: data.signedUrl, expires: Date.now() + SIGNED_TTL * 1000 });
  return data.signedUrl;
}

export async function signedUrls(bucket: "audio" | "covers", paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const path of paths) {
    const hit = signedCache.get(`${bucket}/${path}`);
    if (hit && hit.expires > Date.now() + 60_000) out[path] = hit.url;
    else missing.push(path);
  }
  if (missing.length) {
    const { data } = await supabase().storage.from(bucket).createSignedUrls(missing, SIGNED_TTL);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) {
        out[item.path] = item.signedUrl;
        signedCache.set(`${bucket}/${item.path}`, { url: item.signedUrl, expires: Date.now() + SIGNED_TTL * 1000 });
      }
    }
  }
  return out;
}
