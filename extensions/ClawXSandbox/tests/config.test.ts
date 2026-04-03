import { describe, expect, it } from "vitest";
import { mapToSandboxRuntimeConfig, type ClawXSandboxPluginConfig } from "../src/config.js";

describe("mapToSandboxRuntimeConfig", () => {
  const workspaceDir = "/home/agent/workspace";
  const agentWorkspaceDir = "/home/agent/openclaw";

  it("produces valid defaults with empty plugin config", () => {
    const config = mapToSandboxRuntimeConfig({}, workspaceDir);
    expect(config.network?.allowedDomains).toEqual([]);
    expect(config.network?.deniedDomains).toEqual([]);
    expect(config.filesystem?.allowWrite).toContain(workspaceDir);
    expect(config.filesystem?.denyWrite).toEqual([]);
    expect(config.filesystem?.denyRead).toEqual([]);
  });

  it("always includes workspaceDir in allowWrite", () => {
    const config = mapToSandboxRuntimeConfig({}, workspaceDir);
    expect(config.filesystem?.allowWrite).toContain(workspaceDir);
  });

  it("includes agentWorkspaceDir when different from workspaceDir", () => {
    const config = mapToSandboxRuntimeConfig({}, workspaceDir, agentWorkspaceDir);
    expect(config.filesystem?.allowWrite).toContain(workspaceDir);
    expect(config.filesystem?.allowWrite).toContain(agentWorkspaceDir);
  });

  it("does not duplicate when agentWorkspaceDir equals workspaceDir", () => {
    const config = mapToSandboxRuntimeConfig({}, workspaceDir, workspaceDir);
    const writeEntries = (config.filesystem?.allowWrite ?? []).filter((p) => p === workspaceDir);
    expect(writeEntries).toHaveLength(1);
  });

  it("maps network allowedDomains", () => {
    const pluginConfig: ClawXSandboxPluginConfig = {
      network: { allowedDomains: ["npmjs.org", "pypi.org"] },
    };
    const config = mapToSandboxRuntimeConfig(pluginConfig, workspaceDir);
    expect(config.network?.allowedDomains).toEqual(["npmjs.org", "pypi.org"]);
  });

  it("maps network deniedDomains", () => {
    const pluginConfig: ClawXSandboxPluginConfig = {
      network: { deniedDomains: ["evil.com"] },
    };
    const config = mapToSandboxRuntimeConfig(pluginConfig, workspaceDir);
    expect(config.network?.deniedDomains).toEqual(["evil.com"]);
  });

  it("maps filesystem denyWrite", () => {
    const pluginConfig: ClawXSandboxPluginConfig = {
      filesystem: { denyWrite: ["~/.ssh", "~/.gnupg"] },
    };
    const config = mapToSandboxRuntimeConfig(pluginConfig, workspaceDir);
    expect(config.filesystem?.denyWrite).toEqual(["~/.ssh", "~/.gnupg"]);
  });

  it("maps filesystem denyRead", () => {
    const pluginConfig: ClawXSandboxPluginConfig = {
      filesystem: { denyRead: ["/etc/shadow"] },
    };
    const config = mapToSandboxRuntimeConfig(pluginConfig, workspaceDir);
    expect(config.filesystem?.denyRead).toEqual(["/etc/shadow"]);
  });

  it("merges extra allowWrite paths with workspace", () => {
    const pluginConfig: ClawXSandboxPluginConfig = {
      filesystem: { allowWrite: ["/tmp/build"] },
    };
    const config = mapToSandboxRuntimeConfig(pluginConfig, workspaceDir);
    expect(config.filesystem?.allowWrite).toEqual([workspaceDir, "/tmp/build"]);
  });

  it("passes through unix socket and local binding settings", () => {
    const pluginConfig: ClawXSandboxPluginConfig = {
      network: {
        allowUnixSockets: ["/var/run/docker.sock"],
        allowAllUnixSockets: false,
        allowLocalBinding: true,
      },
    };
    const config = mapToSandboxRuntimeConfig(pluginConfig, workspaceDir);
    expect(config.network?.allowUnixSockets).toEqual(["/var/run/docker.sock"]);
    expect(config.network?.allowAllUnixSockets).toBe(false);
    expect(config.network?.allowLocalBinding).toBe(true);
  });
});
