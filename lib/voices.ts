import type { Locale } from "./dictionaries";

// Mirrors backend/ayvu/language.py. First voice of each language is the default.
export const LANGUAGES: { code: string; label: Record<Locale, string>; voices: string[] }[] = [
  { code: "pt", label: { "pt-BR": "Português (Brasil)", en: "Portuguese (Brazil)" }, voices: ["pf_dora", "pm_alex", "pm_santa"] },
  {
    code: "en",
    label: { "pt-BR": "Inglês", en: "English" },
    voices: ["af_heart", "af_bella", "af_nicole", "am_michael", "am_fenrir", "bf_emma", "bm_george", "bm_fable"],
  },
  { code: "es", label: { "pt-BR": "Espanhol", en: "Spanish" }, voices: ["ef_dora", "em_alex"] },
  { code: "fr", label: { "pt-BR": "Francês", en: "French" }, voices: ["ff_siwis"] },
  { code: "it", label: { "pt-BR": "Italiano", en: "Italian" }, voices: ["if_sara", "im_nicola"] },
  { code: "hi", label: { "pt-BR": "Hindi", en: "Hindi" }, voices: ["hf_alpha", "hf_beta", "hm_omega", "hm_psi"] },
];

const ACCENTS: Record<string, Record<Locale, string>> = {
  a: { "pt-BR": "americano", en: "American" },
  b: { "pt-BR": "britânico", en: "British" },
};

export function voiceLabel(voice: string, locale: Locale): string {
  const [prefix, raw] = voice.split("_");
  const name = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : voice;
  const female = prefix?.[1] === "f";
  const gender = locale === "pt-BR" ? (female ? "feminina" : "masculina") : female ? "female" : "male";
  const accent = ACCENTS[prefix?.[0] ?? ""]?.[locale];
  return accent ? `${name} · ${gender}, ${accent}` : `${name} · ${gender}`;
}

export function languageLabel(code: string | null | undefined, locale: Locale): string {
  if (!code) return "—";
  return LANGUAGES.find((l) => l.code === code)?.label[locale] ?? code.toUpperCase();
}
