import fs from "node:fs";
import { describe, expect, it } from "vitest";

type LocaleDict = Record<string, string>;
type LocaleBundle = {
  zh: LocaleDict;
  en: LocaleDict;
};

const BACKEND_TRACE_FILES = [
  "../src/core/retrieval/reasoning-loop.ts",
  "../src/core/pipeline/heartbeat.ts",
  "../src/core/review/dream-review.ts",
  "../src/runtime.ts",
];

function readText(relativePath: string): string {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function loadLocales(): LocaleBundle {
  const src = readText("../ui-source/app.js");
  const startToken = "const LOCALES = ";
  const endToken = "\n};\n\n/* ── constants & state";
  const start = src.indexOf(startToken);
  const end = src.indexOf(endToken, start);
  if (start === -1 || end === -1) {
    throw new Error("Unable to locate LOCALES in ui-source/app.js");
  }
  const objectLiteral = src.slice(start + startToken.length, end + 2);
  return Function(`return (${objectLiteral});`)() as LocaleBundle;
}

function collectBackendTraceKeys(): string[] {
  const keys = new Set<string>();
  for (const path of BACKEND_TRACE_FILES) {
    const src = readText(path);
    for (const match of src.matchAll(/traceI18n\(\s*"([^"]+)"/g)) {
      keys.add(match[1]);
    }
  }
  return Array.from(keys).sort();
}

function traceLocaleKeys(locale: LocaleDict): string[] {
  return Object.keys(locale).filter((key) => key.startsWith("trace."));
}

function placeholders(template: string): number[] {
  return Array.from(template.matchAll(/\{(\d+)\}/g), (match) => Number(match[1]));
}

describe("trace locale parity", () => {
  const locales = loadLocales();
  const zhTraceKeys = traceLocaleKeys(locales.zh);
  const enTraceKeys = new Set(traceLocaleKeys(locales.en));
  const backendTraceKeys = collectBackendTraceKeys();

  it("keeps english trace locale coverage in sync with zh", () => {
    const missingInEn = zhTraceKeys.filter((key) => !enTraceKeys.has(key));
    expect(missingInEn).toEqual([]);
  });

  it("localizes every backend traceI18n key in both zh and en", () => {
    const missingZh = backendTraceKeys.filter((key) => !Object.prototype.hasOwnProperty.call(locales.zh, key));
    const missingEn = backendTraceKeys.filter((key) => !Object.prototype.hasOwnProperty.call(locales.en, key));
    expect(missingZh).toEqual([]);
    expect(missingEn).toEqual([]);
  });

  it("keeps placeholder indexes aligned between zh and en", () => {
    const mismatched = zhTraceKeys
      .filter((key) => enTraceKeys.has(key))
      .filter((key) => {
        const zhPlaceholders = placeholders(locales.zh[key]);
        const enPlaceholders = placeholders(locales.en[key]);
        return zhPlaceholders.length !== enPlaceholders.length
          || zhPlaceholders.some((value, index) => value !== enPlaceholders[index]);
      });
    expect(mismatched).toEqual([]);
  });
});
