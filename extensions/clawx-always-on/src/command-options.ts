import type { OpenClawPluginApi } from "../api.js";
import type { BudgetExceededAction } from "./core/types.js";

const MAX_LOOPS_RANGE = { min: 1, max: 1000 } as const;
const MAX_COST_USD_RANGE = { min: 0.01, max: 100 } as const;

export type ResolvedModelSelection = {
  modelRef: string;
  provider: string;
  model: string;
};

export type AlwaysOnTaskRequestOptions = {
  modelRef?: string;
  maxLoops?: number;
  maxCostUsd?: number;
  budgetExceededAction?: BudgetExceededAction;
};

export type AlwaysOnDreamCommandOptions = {
  modelRef?: string;
};

type ParseSuccess<TOptions> = {
  ok: true;
  text: string;
  options: TOptions;
};

type ParseFailure = {
  ok: false;
  error: string;
};

type ParseResult<TOptions> = ParseSuccess<TOptions> | ParseFailure;

type TokenizeResult = { ok: true; tokens: string[] } | { ok: false; error: string };

type RawOptions = {
  modelRef?: string;
  maxLoops?: string;
  maxCostUsd?: string;
  budgetExceededAction?: string;
};

type AllowedFlag = keyof RawOptions;

const FLAG_NAME_MAP = {
  "--model": "modelRef",
  "--max-loops": "maxLoops",
  "--max-cost-usd": "maxCostUsd",
  "--budget-exceeded-action": "budgetExceededAction",
} satisfies Record<string, AllowedFlag>;

function resolveAllowedFlagName(name: string): AllowedFlag | undefined {
  if (!(name in FLAG_NAME_MAP)) {
    return undefined;
  }
  return FLAG_NAME_MAP[name as keyof typeof FLAG_NAME_MAP];
}

function withUsage(detail: string, usage: string): string {
  return `${detail}\n\n${usage}`;
}

function tokenizeArgs(raw: string): TokenizeResult {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let escaping = false;

  for (const char of raw.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (quote) {
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === quote) {
        quote = undefined;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    return {
      ok: false,
      error: "Command arguments contain an unterminated quote.",
    };
  }

  if (escaping) {
    current += "\\";
  }

  if (current) {
    tokens.push(current);
  }

  return { ok: true, tokens };
}

function extractOptionToken(token: string): { name: string; inlineValue?: string } {
  const eqIndex = token.indexOf("=");
  if (eqIndex === -1) {
    return { name: token };
  }
  return {
    name: token.slice(0, eqIndex),
    inlineValue: token.slice(eqIndex + 1),
  };
}

function parseKnownOptions(
  raw: string,
  usage: string,
  allowedFlags: Set<AllowedFlag>,
): ParseResult<{
  positionals: string[];
  rawOptions: RawOptions;
}> {
  const tokenized = tokenizeArgs(raw);
  if (!tokenized.ok) {
    return { ok: false, error: withUsage(tokenized.error, usage) };
  }

  const rawOptions: RawOptions = {};
  const positionals: string[] = [];
  let allowOptions = true;

  for (let i = 0; i < tokenized.tokens.length; i++) {
    const token = tokenized.tokens[i] ?? "";
    if (allowOptions && token === "--") {
      allowOptions = false;
      continue;
    }

    if (allowOptions && token.startsWith("--")) {
      const { name, inlineValue } = extractOptionToken(token);
      const normalizedName = resolveAllowedFlagName(name);
      if (!normalizedName) {
        const kebabName = name.startsWith("--") ? name : `--${name}`;
        return {
          ok: false,
          error: withUsage(`Unknown option \`${kebabName}\`.`, usage),
        };
      }
      if (!allowedFlags.has(normalizedName)) {
        return {
          ok: false,
          error: withUsage(`Option \`${name}\` is not supported here.`, usage),
        };
      }
      if (rawOptions[normalizedName] !== undefined) {
        return {
          ok: false,
          error: withUsage(`Option \`${name}\` may only be provided once.`, usage),
        };
      }

      let value = inlineValue;
      if (value === undefined) {
        value = tokenized.tokens[i + 1];
        if (value === undefined) {
          return {
            ok: false,
            error: withUsage(`Option \`${name}\` requires a value.`, usage),
          };
        }
        i += 1;
      }
      rawOptions[normalizedName] = value;
      continue;
    }

    positionals.push(token);
  }

  return { ok: true, text: "", options: { positionals, rawOptions } };
}

function normalizeOptionName(name: AllowedFlag): string {
  switch (name) {
    case "modelRef":
      return "--model";
    case "maxLoops":
      return "--max-loops";
    case "maxCostUsd":
      return "--max-cost-usd";
    case "budgetExceededAction":
      return "--budget-exceeded-action";
  }
}

function normalizeAllowedFlags(
  flags: Array<"--model" | "--max-loops" | "--max-cost-usd" | "--budget-exceeded-action">,
): Set<AllowedFlag> {
  const allowed = new Set<AllowedFlag>();
  for (const flag of flags) {
    allowed.add(FLAG_NAME_MAP[flag]);
  }
  return allowed;
}

export function parseModelRef(modelRef: string): ResolvedModelSelection | undefined {
  const trimmed = modelRef.trim();
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
    return undefined;
  }

  const provider = trimmed.slice(0, slashIndex).trim();
  const model = trimmed.slice(slashIndex + 1).trim();
  if (!provider || !model) {
    return undefined;
  }

  return {
    modelRef: `${provider}/${model}`,
    provider,
    model,
  };
}

export function resolveAgentDefaultModelSelection(
  config: OpenClawPluginApi["config"] | undefined,
): ResolvedModelSelection | undefined {
  const defaultsModel = config?.agents?.defaults?.model;
  const primary =
    typeof defaultsModel === "string"
      ? defaultsModel.trim()
      : typeof defaultsModel === "object" &&
          defaultsModel !== null &&
          "primary" in defaultsModel &&
          typeof (defaultsModel as { primary?: unknown }).primary === "string"
        ? ((defaultsModel as { primary: string }).primary ?? "").trim()
        : "";
  return primary ? parseModelRef(primary) : undefined;
}

function validateTaskOptions(
  rawOptions: RawOptions,
  usage: string,
): ParseResult<AlwaysOnTaskRequestOptions> {
  const options: AlwaysOnTaskRequestOptions = {};

  if (rawOptions.modelRef !== undefined) {
    const selection = parseModelRef(rawOptions.modelRef);
    if (!selection) {
      return {
        ok: false,
        error: withUsage("Option `--model` must be in `provider/model_name` format.", usage),
      };
    }
    options.modelRef = selection.modelRef;
  }

  if (rawOptions.maxLoops !== undefined) {
    const maxLoops = Number.parseInt(rawOptions.maxLoops, 10);
    if (
      !Number.isInteger(maxLoops) ||
      maxLoops < MAX_LOOPS_RANGE.min ||
      maxLoops > MAX_LOOPS_RANGE.max
    ) {
      return {
        ok: false,
        error: withUsage(
          `Option \`${normalizeOptionName("maxLoops")}\` must be an integer between ${MAX_LOOPS_RANGE.min} and ${MAX_LOOPS_RANGE.max}.`,
          usage,
        ),
      };
    }
    options.maxLoops = maxLoops;
  }

  if (rawOptions.maxCostUsd !== undefined) {
    const maxCostUsd = Number(rawOptions.maxCostUsd);
    if (
      !Number.isFinite(maxCostUsd) ||
      maxCostUsd < MAX_COST_USD_RANGE.min ||
      maxCostUsd > MAX_COST_USD_RANGE.max
    ) {
      return {
        ok: false,
        error: withUsage(
          `Option \`${normalizeOptionName("maxCostUsd")}\` must be a number between ${MAX_COST_USD_RANGE.min} and ${MAX_COST_USD_RANGE.max}.`,
          usage,
        ),
      };
    }
    options.maxCostUsd = maxCostUsd;
  }

  if (rawOptions.budgetExceededAction !== undefined) {
    if (
      rawOptions.budgetExceededAction !== "warn" &&
      rawOptions.budgetExceededAction !== "terminate"
    ) {
      return {
        ok: false,
        error: withUsage(
          "Option `--budget-exceeded-action` must be either `warn` or `terminate`.",
          usage,
        ),
      };
    }
    options.budgetExceededAction = rawOptions.budgetExceededAction;
  }

  return { ok: true, text: "", options };
}

function buildTaskUsage(subcommand: "create" | "plan"): string {
  return `Usage: \`/always-on ${subcommand} <task description> [--model provider/model_name] [--max-loops N] [--max-cost-usd USD] [--budget-exceeded-action warn|terminate]\``;
}

export function parseTaskCommandInput(
  raw: string,
  subcommand: "create" | "plan",
): ParseResult<AlwaysOnTaskRequestOptions> {
  const usage = buildTaskUsage(subcommand);
  const parsed = parseKnownOptions(
    raw,
    usage,
    normalizeAllowedFlags(["--model", "--max-loops", "--max-cost-usd", "--budget-exceeded-action"]),
  );
  if (!parsed.ok) {
    return parsed;
  }

  const text = parsed.options.positionals.join(" ").trim();
  if (!text) {
    return { ok: false, error: usage };
  }

  const validated = validateTaskOptions(parsed.options.rawOptions, usage);
  if (!validated.ok) {
    return validated;
  }

  return {
    ok: true,
    text,
    options: validated.options,
  };
}

export function parseDreamCommandInput(raw: string): ParseResult<AlwaysOnDreamCommandOptions> {
  const usage = "Usage: `/always-on dream [--model provider/model_name]`";
  const parsed = parseKnownOptions(raw, usage, normalizeAllowedFlags(["--model"]));
  if (!parsed.ok) {
    return parsed;
  }

  if (parsed.options.positionals.length > 0) {
    return {
      ok: false,
      error: withUsage("Dream does not accept a free-form task description.", usage),
    };
  }

  if (parsed.options.rawOptions.modelRef === undefined) {
    return {
      ok: true,
      text: "",
      options: {},
    };
  }

  const selection = parseModelRef(parsed.options.rawOptions.modelRef);
  if (!selection) {
    return {
      ok: false,
      error: withUsage("Option `--model` must be in `provider/model_name` format.", usage),
    };
  }

  return {
    ok: true,
    text: "",
    options: { modelRef: selection.modelRef },
  };
}
