import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBwrapFsBridge } from "../src/fs-bridge.js";

describe("createBwrapFsBridge", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawx-sandbox-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeBridge() {
    return createBwrapFsBridge({
      workspaceDir: tmpDir,
      containerWorkdir: "/workspace",
    });
  }

  describe("resolvePath", () => {
    it("resolves absolute paths as-is", () => {
      const bridge = makeBridge();
      const resolved = bridge.resolvePath({ filePath: "/etc/hosts" });
      expect(resolved.hostPath).toBe("/etc/hosts");
      // Absolute paths outside workspace produce a relative path with ../
      // so containerPath reflects the relative offset from workspace root
      expect(resolved.containerPath).toBeDefined();
    });

    it("resolves relative paths against workspace", () => {
      const bridge = makeBridge();
      const resolved = bridge.resolvePath({ filePath: "src/main.ts" });
      expect(resolved.hostPath).toBe(path.join(tmpDir, "src/main.ts"));
      expect(resolved.relativePath).toBe("src/main.ts");
      expect(resolved.containerPath).toBe("/workspace/src/main.ts");
    });

    it("resolves relative paths against custom cwd", () => {
      const bridge = makeBridge();
      const resolved = bridge.resolvePath({
        filePath: "file.txt",
        cwd: "/other/dir",
      });
      expect(resolved.hostPath).toBe("/other/dir/file.txt");
    });
  });

  describe("writeFile + readFile", () => {
    it("writes and reads a file", async () => {
      const bridge = makeBridge();
      const filePath = path.join(tmpDir, "test.txt");
      await bridge.writeFile({ filePath, data: "hello world" });
      const content = await bridge.readFile({ filePath });
      expect(content.toString("utf8")).toBe("hello world");
    });

    it("creates parent directories with mkdir option", async () => {
      const bridge = makeBridge();
      const filePath = path.join(tmpDir, "deep", "nested", "file.txt");
      await bridge.writeFile({ filePath, data: "nested", mkdir: true });
      const content = await bridge.readFile({ filePath });
      expect(content.toString("utf8")).toBe("nested");
    });
  });

  describe("stat", () => {
    it("returns file stats", async () => {
      const bridge = makeBridge();
      const filePath = path.join(tmpDir, "stat-test.txt");
      await fs.writeFile(filePath, "data");
      const stat = await bridge.stat({ filePath });
      expect(stat).not.toBeNull();
      expect(stat!.type).toBe("file");
      expect(stat!.size).toBe(4);
    });

    it("returns directory stats", async () => {
      const bridge = makeBridge();
      const stat = await bridge.stat({ filePath: tmpDir });
      expect(stat).not.toBeNull();
      expect(stat!.type).toBe("directory");
    });

    it("returns null for non-existent paths", async () => {
      const bridge = makeBridge();
      const stat = await bridge.stat({
        filePath: path.join(tmpDir, "nonexistent"),
      });
      expect(stat).toBeNull();
    });
  });

  describe("mkdirp", () => {
    it("creates nested directories", async () => {
      const bridge = makeBridge();
      const dirPath = path.join(tmpDir, "a", "b", "c");
      await bridge.mkdirp({ filePath: dirPath });
      const stat = await fs.stat(dirPath);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe("remove", () => {
    it("removes a file", async () => {
      const bridge = makeBridge();
      const filePath = path.join(tmpDir, "to-remove.txt");
      await fs.writeFile(filePath, "bye");
      await bridge.remove({ filePath });
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it("removes a directory recursively", async () => {
      const bridge = makeBridge();
      const dirPath = path.join(tmpDir, "dir-to-remove");
      await fs.mkdir(dirPath);
      await fs.writeFile(path.join(dirPath, "inner.txt"), "inner");
      await bridge.remove({ filePath: dirPath, recursive: true });
      await expect(fs.access(dirPath)).rejects.toThrow();
    });
  });

  describe("rename", () => {
    it("renames a file", async () => {
      const bridge = makeBridge();
      const from = path.join(tmpDir, "old-name.txt");
      const to = path.join(tmpDir, "new-name.txt");
      await fs.writeFile(from, "content");
      await bridge.rename({ from, to });
      await expect(fs.access(from)).rejects.toThrow();
      const content = await fs.readFile(to, "utf8");
      expect(content).toBe("content");
    });
  });
});
