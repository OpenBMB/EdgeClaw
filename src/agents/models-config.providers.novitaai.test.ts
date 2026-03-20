import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withEnvAsync } from "../test-utils/env.js";
import { resolveImplicitProvidersForTest } from "./models-config.e2e-harness.js";
import { buildNovitaProvider, NOVITA_DEFAULT_MODEL_ID } from "./models-config.providers.js";

describe("Novita AI provider", () => {
  it("should include novitaai when NOVITA_API_KEY is configured", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "openclaw-test-"));
    await withEnvAsync({ NOVITA_API_KEY: "test-key" }, async () => {
      const providers = await resolveImplicitProvidersForTest({ agentDir });
      expect(providers?.novitaai).toBeDefined();
      expect(providers?.novitaai?.models?.length).toBeGreaterThan(0);
    });
  });

  it("should not include novitaai when NOVITA_API_KEY is absent", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "openclaw-test-"));
    await withEnvAsync({ NOVITA_API_KEY: undefined }, async () => {
      const providers = await resolveImplicitProvidersForTest({ agentDir });
      expect(providers?.novitaai).toBeUndefined();
    });
  });

  it("should build novitaai provider with correct configuration", () => {
    const provider = buildNovitaProvider();
    expect(provider.baseUrl).toBe("https://api.novita.ai/openai");
    expect(provider.api).toBe("openai-completions");
    expect(provider.models).toBeDefined();
    expect(provider.models.length).toBeGreaterThan(0);
  });

  it("should include default Novita model IDs", () => {
    const provider = buildNovitaProvider();
    const modelIds = provider.models.map((m) => m.id);
    expect(modelIds).toContain(NOVITA_DEFAULT_MODEL_ID);
    expect(modelIds).toContain("zai-org/glm-5");
    expect(modelIds).toContain("minimax/minimax-m2.5");
  });

  it("should set apiKey from env var when NOVITA_API_KEY is present", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "openclaw-test-"));
    await withEnvAsync({ NOVITA_API_KEY: "novita-test-api-key" }, async () => {
      const providers = await resolveImplicitProvidersForTest({ agentDir });
      expect(providers?.novitaai?.apiKey).toBe("NOVITA_API_KEY");
    });
  });
});
