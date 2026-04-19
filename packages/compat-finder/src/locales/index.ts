import { enMessages } from "./en.ts";
import type { CliLocale, CliMessages } from "./types.ts";
import { zhCnMessages } from "./zh-CN.ts";

export type { CliLocale, CliMessages } from "./types.ts";

const CLI_MESSAGES: Record<CliLocale, CliMessages> = {
  en: enMessages,
  "zh-CN": zhCnMessages,
};

const SUPPORTED_LOCALES = Object.keys(CLI_MESSAGES) as CliLocale[];

export function getCliMessages(locale: CliLocale): CliMessages {
  return CLI_MESSAGES[locale];
}

export function isSupportedCliLocale(locale: string): locale is CliLocale {
  return SUPPORTED_LOCALES.includes(locale as CliLocale);
}

export function normalizeCliLocale(locale: string | undefined): CliLocale | undefined {
  const normalizedLocale = locale?.trim().replace("_", "-");

  if (!normalizedLocale || normalizedLocale === "C" || normalizedLocale === "POSIX") {
    return undefined;
  }

  const [language, regionWithEncoding] = normalizedLocale.split("-");
  const region = regionWithEncoding?.split(".")[0]?.toUpperCase();

  if (language.toLowerCase() === "zh") {
    return region === "CN" || region === "SG" || !region ? "zh-CN" : "en";
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
