import type { ProviderCatalogEntry } from "../types.ts";
import { CLOUD_CN } from "./cloud-cn.ts";
import { CLOUD_GLOBAL } from "./cloud-global.ts";
import { LOCAL } from "./local.ts";

export const CATALOG: ProviderCatalogEntry[] = [...CLOUD_GLOBAL, ...CLOUD_CN, ...LOCAL];

export function findCatalogEntry(id: string): ProviderCatalogEntry | undefined {
  return CATALOG.find((entry) => entry.id === id);
}
