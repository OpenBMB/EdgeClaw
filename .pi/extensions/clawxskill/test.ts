/**
 * Standalone test for clawxskill extension core logic.
 *
 * Run: npx tsx .pi/extensions/clawxskill/test.ts
 */
import { InvertedIndex, tokenize } from "./engines/inverted-index.js";
import { SkillBackup } from "./skill-backup.js";
import type { SkillMeta } from "./types.js";
import { extractSkillName } from "./watcher.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

// ---- Tokenizer tests ----
console.log("\n== Tokenizer ==");

assert(tokenize("hello world").join(",") === "hello,world", "basic tokenize");
assert(tokenize("Convert PDF files").join(",") === "convert,pdf,files", "tokenize lowercases");
const cjkTokens = tokenize("帮我转换PDF");
assert(
  cjkTokens.includes("帮我") && cjkTokens.includes("我转") && cjkTokens.includes("pdf"),
  "tokenize handles CJK bigrams + ascii",
);
assert(tokenize("a b").length === 0, "tokenize filters short tokens");
assert(
  tokenize("file-converter suite").join(",") === "file,converter,suite",
  "tokenize splits on hyphens",
);

// ---- BM25 Index tests ----
console.log("\n== BM25 Index ==");

const skills: SkillMeta[] = [
  {
    name: "converter",
    description: "Convert between 8 formats PDF DOCX PPTX",
    filePath: "/skills/converter/SKILL.md",
    tokens: tokenize("converter Convert between 8 formats PDF DOCX PPTX"),
  },
  {
    name: "security-triage",
    description: "Security audit and auth token review",
    filePath: "/skills/security-triage/SKILL.md",
    tokens: tokenize("security-triage Security audit and auth token review"),
  },
  {
    name: "cold-chain",
    description: "冷链仓库到货验收 语音转文字入库",
    filePath: "/skills/cold-chain/SKILL.md",
    tokens: tokenize("cold-chain 冷链仓库到货验收 语音转文字入库"),
  },
  {
    name: "code-refactor",
    description: "Code refactoring helper with best practices",
    filePath: "/skills/code-refactor/SKILL.md",
    tokens: tokenize("code-refactor Code refactoring helper with best practices"),
  },
  {
    name: "test-runner",
    description: "Run and manage test suites",
    filePath: "/skills/test-runner/SKILL.md",
    tokens: tokenize("test-runner Run and manage test suites"),
  },
];

const idx = new InvertedIndex();
idx.build(skills);

assert(idx.getSkillCount() === 5, "index has 5 skills");

// Keyword match
const r1 = idx.searchSync("PDF converter");
assert(
  r1.length > 0 && r1[0].skill.name === "converter",
  "PDF converter → converter skill (rank 1)",
);

// Security keyword
const r2 = idx.searchSync("auth token security");
assert(
  r2.length > 0 && r2[0].skill.name === "security-triage",
  "auth token security → security-triage (rank 1)",
);

// Chinese keywords
const r3 = idx.searchSync("验收入库");
assert(r3.length > 0 && r3[0].skill.name === "cold-chain", "验收入库 → cold-chain (rank 1)");

// Refactoring match
const r4 = idx.searchSync("refactor the code");
assert(
  r4.length > 0 && r4[0].skill.name === "code-refactor",
  "refactor the code → code-refactor (rank 1)",
);

// No match
const r5 = idx.searchSync("zzzzz nothing");
assert(r5.length === 0, "gibberish → no results");

// Max 3 results
const r6 = idx.searchSync("code test run manage");
assert(r6.length <= 3, "max 3 results returned");

// ---- Incremental update tests ----
console.log("\n== Incremental Update ==");

idx.addSkill({
  name: "new-skill",
  description: "Brand new skill for deployment",
  filePath: "/skills/new-skill/SKILL.md",
  tokens: tokenize("new-skill Brand new skill for deployment"),
});
assert(idx.getSkillCount() === 6, "add → 6 skills");

const r7 = idx.searchSync("deployment");
assert(r7.length > 0 && r7[0].skill.name === "new-skill", "deployment → new-skill after add");

idx.removeSkill("new-skill");
assert(idx.getSkillCount() === 5, "remove → 5 skills");

const r8 = idx.searchSync("deployment");
assert(r8.length === 0, "deployment → no results after remove");

// ---- SkillBackup tests ----
console.log("\n== Skill Backup ==");

const backup = new SkillBackup();
assert(backup.size === 0, "starts empty");

backup.record("converter", "# Converter\nConvert files...");
backup.record("security-triage", "# Security\nAudit auth...");
assert(backup.size === 2, "has 2 entries after recording");

const payload = backup.getRestorationPayload();
assert(payload.length === 2, "restores 2 skills");
assert(payload[0].name === "security-triage", "most recent first (security-triage)");

// ---- extractSkillName tests ----
console.log("\n== extractSkillName ==");

assert(
  extractSkillName("/home/user/.agents/skills/converter/SKILL.md") === "converter",
  "extracts from standard path",
);
assert(
  extractSkillName("/repo/.agents/skills/my-skill/SKILL.md") === "my-skill",
  "extracts from project path",
);
assert(extractSkillName("/some/random/file.ts") === null, "returns null for non-skill path");
assert(
  extractSkillName("C:\\Users\\test\\skills\\foo\\SKILL.md") === "foo",
  "handles Windows paths",
);

// ---- Edge cases ----
console.log("\n== Edge Cases ==");

// Empty index search
const emptyIdx = new InvertedIndex();
emptyIdx.build([]);
const r9 = emptyIdx.searchSync("anything");
assert(r9.length === 0, "empty index returns no results");

// Empty query
const r10 = idx.searchSync("");
assert(r10.length === 0, "empty query returns no results");

// Partial match with CJK
const r11 = idx.searchSync("冷链");
assert(
  r11.length > 0 && r11[0].skill.name === "cold-chain",
  "冷链 → cold-chain (CJK bigram partial match)",
);

// Update same skill (remove then add)
idx.addSkill({
  name: "converter",
  description: "Updated: now supports 10 formats including CSV",
  filePath: "/skills/converter/SKILL.md",
  tokens: tokenize("converter Updated: now supports 10 formats including CSV"),
});
const r12 = idx.searchSync("CSV");
assert(r12.length > 0 && r12[0].skill.name === "converter", "CSV → converter after update");
// remove the duplicate
idx.removeSkill("converter");
// the original was already replaced in allSkills by addSkill, but
// BM25's allSkills is an array so both entries exist. Let's verify count.
const r13 = idx.searchSync("PDF DOCX");
// After removing "converter", both entries (old+new) with that name are gone
assert(idx.getSkillCount() === 4, "after removing converter: 4 skills remain");

// Backup budget limiting
console.log("\n== Backup Budget ==");
const bigBackup = new SkillBackup();
const hugeContent = "x".repeat(120_000); // ~30K tokens, exceeds PER_SKILL_LIMIT
bigBackup.record("huge-skill", hugeContent);
const payload2 = bigBackup.getRestorationPayload();
assert(
  payload2.length === 1 && payload2[0].content.length <= 20_001,
  "huge skill content is truncated within PER_SKILL_LIMIT",
);

// Multiple skills filling budget
const budgetBackup = new SkillBackup();
for (let i = 0; i < 20; i++) {
  budgetBackup.record(`skill-${i}`, "a".repeat(8_000)); // ~2K tokens each
}
const payload3 = budgetBackup.getRestorationPayload();
assert(payload3.length < 20, `budget limits restored skills: ${payload3.length} < 20`);

// ---- SkillBackup: multi-trigger heuristic detection ----
console.log("\n== Backup Heuristic Detection ==");

const heuristicBackup = new SkillBackup();

// Simulate a tool_result containing frontmatter-like SKILL.md content
const fakeSkillContent = `---
name: deploy-helper
description: Helps with deployment workflows
when_to_use: When user asks about deploying
allowed-tools: [Bash, Read]
---

Deploy the application to the target environment.

Steps:
1. Run tests
2. Build artifacts
3. Deploy
`;

// The heuristic check from index.ts: frontmatter markers + known keywords
const looksLikeSkill =
  /^---\s*\n[\s\S]*?^---\s*\n/m.test(fakeSkillContent) &&
  /\b(description|when.?to.?use|allowed.?tools)\b/i.test(fakeSkillContent);
assert(looksLikeSkill, "heuristic detects SKILL.md-like content");

const nameMatch = fakeSkillContent.match(/(?:^|\n)name:\s*["']?([^\n"']+)/);
assert(
  nameMatch !== null && nameMatch[1].trim() === "deploy-helper",
  "heuristic extracts skill name",
);

// Non-skill content should NOT match
const regularContent = `This is just a normal code review result.
The file has 15 functions and 3 classes.
No issues found.`;
const looksLikeSkill2 =
  /^---\s*\n[\s\S]*?^---\s*\n/m.test(regularContent) &&
  /\b(description|when.?to.?use|allowed.?tools)\b/i.test(regularContent);
assert(!looksLikeSkill2, "heuristic rejects non-skill content");

// record + has check
heuristicBackup.record("deploy-helper", fakeSkillContent);
assert(heuristicBackup.has("deploy-helper"), "backup.has() works after record");
assert(!heuristicBackup.has("nonexistent"), "backup.has() returns false for unknown");

// Slash command simulation: record with clean name
const rawCommandName = "/skill:my-cool-skill";
const cleanName = rawCommandName.replace(/^\/?(skill:)?/, "");
assert(cleanName === "my-cool-skill", "slash command name cleaning works");

// ---- Summary ----
console.log(`\n== Results: ${passed} passed, ${failed} failed ==\n`);
process.exit(failed > 0 ? 1 : 0);
