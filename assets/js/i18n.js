const MOJIBAKE_RE = /[ÃÂâ][^\s]*/;

export function repairMojibake(value) {
  const text = String(value ?? "");
  if (!text || !MOJIBAKE_RE.test(text)) return text;
  try {
    const bytes = Uint8Array.from([...text].map((char) => char.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return decoded || text;
  } catch (error) {
    return text;
  }
}

export function createMissingTranslationTracker(logger = console.warn) {
  const seen = new Set();
  return {
    report(key, lang) {
      const normalizedKey = String(key || "").trim();
      const normalizedLang = String(lang || "").trim() || "unknown";
      if (!normalizedKey) return;
      const token = `${normalizedLang}::${normalizedKey}`;
      if (seen.has(token)) return;
      seen.add(token);
      logger(`[i18n] Missing translation for "${normalizedKey}" in ${normalizedLang}`);
    }
  };
}
