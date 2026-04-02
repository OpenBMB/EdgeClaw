import fs from "node:fs/promises";
import path from "node:path";
import type {
  SandboxFsBridge,
  SandboxFsStat,
  SandboxResolvedPath,
} from "openclaw/plugin-sdk/sandbox";

/**
 * Pass-through fsBridge for the bwrap backend.
 *
 * Since bwrap runs on the host filesystem (unlike Docker which has an
 * isolated rootfs), all paths map to themselves — no docker-cp or
 * remote-shell indirection is needed.
 */
export function createBwrapFsBridge(params: {
  workspaceDir: string;
  containerWorkdir: string;
}): SandboxFsBridge {
  const { workspaceDir, containerWorkdir } = params;

  function resolveAbsolute(filePath: string, cwd?: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.resolve(cwd ?? workspaceDir, filePath);
  }

  return {
    resolvePath(p: { filePath: string; cwd?: string }): SandboxResolvedPath {
      const abs = resolveAbsolute(p.filePath, p.cwd);
      const rel = path.relative(workspaceDir, abs);
      return {
        hostPath: abs,
        relativePath: rel,
        containerPath: path.join(containerWorkdir, rel),
      };
    },

    async readFile(p: { filePath: string; cwd?: string; signal?: AbortSignal }): Promise<Buffer> {
      const abs = resolveAbsolute(p.filePath, p.cwd);
      return fs.readFile(abs, { signal: p.signal });
    },

    async writeFile(p: {
      filePath: string;
      cwd?: string;
      data: Buffer | string;
      encoding?: BufferEncoding;
      mkdir?: boolean;
      signal?: AbortSignal;
    }): Promise<void> {
      const abs = resolveAbsolute(p.filePath, p.cwd);
      if (p.mkdir) {
        await fs.mkdir(path.dirname(abs), { recursive: true });
      }
      await fs.writeFile(abs, p.data, {
        encoding: p.encoding,
        signal: p.signal,
      });
    },

    async mkdirp(p: { filePath: string; cwd?: string; signal?: AbortSignal }): Promise<void> {
      const abs = resolveAbsolute(p.filePath, p.cwd);
      await fs.mkdir(abs, { recursive: true });
    },

    async remove(p: {
      filePath: string;
      cwd?: string;
      recursive?: boolean;
      force?: boolean;
      signal?: AbortSignal;
    }): Promise<void> {
      const abs = resolveAbsolute(p.filePath, p.cwd);
      await fs.rm(abs, { recursive: p.recursive ?? false, force: p.force ?? false });
    },

    async rename(p: {
      from: string;
      to: string;
      cwd?: string;
      signal?: AbortSignal;
    }): Promise<void> {
      const absFrom = resolveAbsolute(p.from, p.cwd);
      const absTo = resolveAbsolute(p.to, p.cwd);
      await fs.rename(absFrom, absTo);
    },

    async stat(p: {
      filePath: string;
      cwd?: string;
      signal?: AbortSignal;
    }): Promise<SandboxFsStat | null> {
      const abs = resolveAbsolute(p.filePath, p.cwd);
      try {
        const s = await fs.stat(abs);
        return {
          type: s.isDirectory() ? "directory" : s.isFile() ? "file" : "other",
          size: s.size,
          mtimeMs: s.mtimeMs,
        };
      } catch {
        return null;
      }
    },
  };
}
