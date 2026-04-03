import * as fs from "node:fs";
import * as path from "node:path";

export interface NotebookCell {
  cell_type: "code" | "markdown" | "raw";
  source: string[];
  metadata: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
}

export interface Notebook {
  nbformat: number;
  nbformat_minor: number;
  metadata: Record<string, unknown>;
  cells: NotebookCell[];
}

function sourceToLines(source: string): string[] {
  if (!source) return [""];
  const lines = source.split("\n");
  return lines.map((line, i) => (i < lines.length - 1 ? line + "\n" : line));
}

function linesToString(lines: string[]): string {
  return lines.join("");
}

export function readNotebook(filePath: string): Notebook {
  const abs = path.resolve(filePath);
  const raw = fs.readFileSync(abs, "utf-8");
  const nb = JSON.parse(raw) as Notebook;

  if (!nb.nbformat || nb.nbformat < 4) {
    throw new Error(`Unsupported notebook format: nbformat ${nb.nbformat ?? "unknown"}`);
  }
  if (!Array.isArray(nb.cells)) {
    throw new Error("Invalid notebook: missing cells array");
  }

  return nb;
}

export function formatNotebook(nb: Notebook, cellIndex?: number): string {
  const cells = cellIndex !== undefined ? [nb.cells[cellIndex]] : nb.cells;
  const startIdx = cellIndex ?? 0;

  if (cellIndex !== undefined && !nb.cells[cellIndex]) {
    throw new Error(`Cell index ${cellIndex} out of range (0..${nb.cells.length - 1})`);
  }

  const parts: string[] = [];
  cells.forEach((cell, i) => {
    const idx = startIdx + i;
    const src = linesToString(cell.source);
    const lang = cell.cell_type === "code" ? "python" : cell.cell_type;
    parts.push(`### Cell ${idx} [${cell.cell_type}]\n\`\`\`${lang}\n${src}\n\`\`\``);

    if (cell.cell_type === "code" && Array.isArray(cell.outputs) && cell.outputs.length > 0) {
      const outputText = cell.outputs
        .map((o: unknown) => {
          const out = o as Record<string, unknown>;
          if (out.text) return (out.text as string[]).join("");
          if (out.data && typeof out.data === "object") {
            const data = out.data as Record<string, unknown>;
            if (data["text/plain"]) return (data["text/plain"] as string[]).join("");
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
      if (outputText) {
        parts.push(`**Output:**\n\`\`\`\n${outputText}\n\`\`\``);
      }
    }
  });

  return parts.join("\n\n");
}

export function editNotebookCell(
  filePath: string,
  cellIndex: number,
  source: string,
  cellType?: "code" | "markdown" | "raw",
  createIfMissing?: boolean,
): { notebook: Notebook; summary: string } {
  const abs = path.resolve(filePath);
  let nb: Notebook;

  if (!fs.existsSync(abs)) {
    if (!createIfMissing) {
      throw new Error(`File not found: ${abs}`);
    }
    nb = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
        language_info: { name: "python", version: "3.11.0" },
      },
      cells: [],
    };
  } else {
    nb = readNotebook(filePath);
  }

  const newLines = sourceToLines(source);
  const type = cellType ?? "code";

  if (cellIndex >= nb.cells.length) {
    while (nb.cells.length < cellIndex) {
      nb.cells.push({
        cell_type: "code",
        source: [""],
        metadata: {},
        outputs: [],
        execution_count: null,
      });
    }

    const newCell: NotebookCell = {
      cell_type: type,
      source: newLines,
      metadata: {},
      ...(type === "code" ? { outputs: [], execution_count: null } : {}),
    };
    nb.cells.push(newCell);

    fs.writeFileSync(abs, JSON.stringify(nb, null, 1) + "\n", "utf-8");
    return { notebook: nb, summary: `Created new cell ${cellIndex} (${type})` };
  }

  const existing = nb.cells[cellIndex];
  const oldSrc = linesToString(existing.source);
  existing.source = newLines;
  if (cellType && cellType !== existing.cell_type) {
    existing.cell_type = cellType;
    if (cellType === "code") {
      existing.outputs = existing.outputs ?? [];
      existing.execution_count = existing.execution_count ?? null;
    }
  }

  fs.writeFileSync(abs, JSON.stringify(nb, null, 1) + "\n", "utf-8");

  const changed = oldSrc !== source;
  return {
    notebook: nb,
    summary: changed
      ? `Updated cell ${cellIndex} (${existing.cell_type})`
      : `Cell ${cellIndex} unchanged`,
  };
}
