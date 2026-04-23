import { enMessages } from "./en.ts";
import type { CliLocale, CliMessages } from "./types.ts";
import { zhHansMessages } from "./zh-Hans.ts";

export type { CliLocale, CliMessages } from "./types.ts";

const CLI_MESSAGES = {
  en: enMessages,
  "zh-Hans": zhHansMessages,
} satisfies Record<CliLocale, CliMessages>;

const SUPPORTED_LOCALES = ["en", "zh-Hans"] as const satisfies readonly CliLocale[];

export function getCliMessages(locale: CliLocale): CliMessages {
  return CLI_MESSAGES[locale];
}

export function isSupportedCliLocale(locale: string): locale is CliLocale {
  return SUPPORTED_LOCALES.some((supportedLocale) => supportedLocale === locale);
}

export function normalizeCliLocale(locale: string | undefined): CliLocale | undefined {
  const normalizedLocale = locale?.trim().replaceAll("_", "-").split(".")[0].split("@")[0];

  if (!normalizedLocale || normalizedLocale === "C" || normalizedLocale === "POSIX") {
    return undefined;
  }

  const [language, scriptOrRegion, region] = normalizedLocale.split("-");

  if (language.toLowerCase() === "zh") {
    const normalizedScriptOrRegion = scriptOrRegion?.toLowerCase();
    if (normalizedScriptOrRegion === "hans") {
      return "zh-Hans";
    }

    const legacyRegion = scriptOrRegion?.toUpperCase();
    const normalizedRegion = region?.toUpperCase();
    return legacyRegion === "CN" ||
      legacyRegion === "SG" ||
      normalizedRegion === "CN" ||
      normalizedRegion === "SG" ||
      !legacyRegion
      ? "zh-Hans"
      : undefined;
  }

  if (language.toLowerCase() === "en") {
    return "en";
  }

  return undefined;
}

export function resolveCliLocale(requestedLocale: string | undefined, env: NodeJS.ProcessEnv): CliLocale {
  return (
    normalizeCliLocale(requestedLocale) ??
    normalizeCliLocale(env.COMPAT_FINDER_LOCALE) ??
    normalizeCliLocale(env.LC_ALL) ??
    normalizeCliLocale(env.LC_MESSAGES) ??
    normalizeCliLocale(env.LANG) ??
    "en"
  );
}
