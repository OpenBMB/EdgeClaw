import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf-8")) as Record<string, any>;
const pluginManifest = JSON.parse(readFileSync(join(packageDir, "openclaw.plugin.json"), "utf-8")) as Record<string, any>;

describe("package metadata", () => {
  it("targets OpenClaw 2026.4.2+ and public npm packaging", () => {
    expect(packageJson.name).toBe("openbmb-clawxmemory");
    expect(packageJson.peerDependencies?.openclaw).toBe(">=2026.4.2");
    expect(packageJson.publishConfig?.access).toBe("public");
    expect(packageJson.files).toEqual(
      expect.arrayContaining([
        "dist",
        "src",
        "ui-source",
        "agent-skills",
        "skills",
        "openclaw.plugin.json",
        "LICENSE",
      ]),
    );
  });

  it("declares ClawHub compatibility metadata for code-plugin publishing", () => {
    expect(packageJson.openclaw?.extensions).toEqual(["./src/index.ts"]);
    expect(packageJson.openclaw?.compat).toEqual({
      pluginApi: ">=2026.4.2",
      minGatewayVersion: "2026.4.2",
    });
    expect(packageJson.openclaw?.build).toEqual({
      openclawVersion: "2026.4.2",
    });
  });

  it("removes legacy manifests from the package root", () => {
    expect(existsSync(join(packageDir, "clawdbot.plugin.json"))).toBe(false);
    expect(existsSync(join(packageDir, "moltbot.plugin.json"))).toBe(false);
    expect(existsSync(join(packageDir, "openclaw.plugin.json"))).toBe(true);
  });

  it("keeps a schema-clean native plugin manifest", () => {
    expect(pluginManifest.id).toBe("openbmb-clawxmemory");
    expect(pluginManifest.main).toBeUndefined();
    expect(pluginManifest.version).toBe(packageJson.version);
  });
});
