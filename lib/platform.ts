import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

export const isNative = () => typeof window !== "undefined" && Capacitor.isNativePlatform();

/** Small key/value store: Preferences on device (survives WebView storage eviction), localStorage on web. */
export const kv = {
  async get(key: string): Promise<string | null> {
    if (isNative()) return (await Preferences.get({ key })).value;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    if (isNative()) return Preferences.set({ key, value });
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode / quota: non-critical */
    }
  },
  async remove(key: string): Promise<void> {
    if (isNative()) return Preferences.remove({ key });
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  async getJSON<T>(key: string): Promise<T | null> {
    const raw = await kv.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  setJSON(key: string, value: unknown) {
    return kv.set(key, JSON.stringify(value));
  },
};
