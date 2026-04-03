export type SecurityLevel = "safe" | "needs_approval" | "dangerous" | "unknown";

export interface CommandPattern {
  pattern: RegExp;
  level: SecurityLevel;
  reason: string;
}

export const SAFE_COMMANDS: CommandPattern[] = [
  { pattern: /^ls\b/, level: "safe", reason: "List directory contents (read-only)" },
  { pattern: /^cat\b/, level: "safe", reason: "Display file contents (read-only)" },
  { pattern: /^head\b/, level: "safe", reason: "Display first lines (read-only)" },
  { pattern: /^tail\b/, level: "safe", reason: "Display last lines (read-only)" },
  { pattern: /^grep\b/, level: "safe", reason: "Search file contents (read-only)" },
  { pattern: /^rg\b/, level: "safe", reason: "Ripgrep search (read-only)" },
  { pattern: /^find\b/, level: "safe", reason: "Find files (read-only)" },
  { pattern: /^wc\b/, level: "safe", reason: "Word/line count (read-only)" },
  { pattern: /^file\b/, level: "safe", reason: "Detect file type (read-only)" },
  { pattern: /^stat\b/, level: "safe", reason: "File statistics (read-only)" },
  { pattern: /^echo\b/, level: "safe", reason: "Print text (read-only)" },
  { pattern: /^printf\b/, level: "safe", reason: "Formatted print (read-only)" },
  { pattern: /^date\b/, level: "safe", reason: "Show date/time (read-only)" },
  { pattern: /^whoami\b/, level: "safe", reason: "Show current user (read-only)" },
  { pattern: /^hostname\b/, level: "safe", reason: "Show hostname (read-only)" },
  { pattern: /^uname\b/, level: "safe", reason: "System information (read-only)" },
  { pattern: /^pwd\b/, level: "safe", reason: "Print working directory (read-only)" },
  { pattern: /^env\b/, level: "safe", reason: "Show environment (read-only)" },
  { pattern: /^which\b/, level: "safe", reason: "Locate command (read-only)" },
  { pattern: /^type\b/, level: "safe", reason: "Describe command (read-only)" },
  { pattern: /^diff\b/, level: "safe", reason: "Compare files (read-only)" },
  { pattern: /^du\b/, level: "safe", reason: "Disk usage (read-only)" },
  { pattern: /^df\b/, level: "safe", reason: "Disk free space (read-only)" },
  { pattern: /^less\b/, level: "safe", reason: "Page through file (read-only)" },
  { pattern: /^more\b/, level: "safe", reason: "Page through file (read-only)" },
  { pattern: /^tree\b/, level: "safe", reason: "Directory tree (read-only)" },
  { pattern: /^man\b/, level: "safe", reason: "Manual page (read-only)" },
  {
    pattern: /^git\s+(status|log|diff|show|branch|tag|remote|config\s+--get)\b/,
    level: "safe",
    reason: "Git read-only operation",
  },
  { pattern: /^git\s+ls-files\b/, level: "safe", reason: "Git list tracked files (read-only)" },
  {
    pattern: /^python3?\s+-c\s+['"].*print/,
    level: "safe",
    reason: "Simple Python print expression",
  },
  {
    pattern: /^node\s+-e\s+['"].*console\.log/,
    level: "safe",
    reason: "Simple Node.js console.log expression",
  },
];

export const WRITE_COMMANDS: CommandPattern[] = [
  { pattern: /^cp\b/, level: "needs_approval", reason: "Copy files (writes to filesystem)" },
  { pattern: /^mv\b/, level: "needs_approval", reason: "Move/rename files" },
  { pattern: /^mkdir\b/, level: "needs_approval", reason: "Create directory" },
  { pattern: /^touch\b/, level: "needs_approval", reason: "Create/update file timestamp" },
  { pattern: /^tee\b/, level: "needs_approval", reason: "Write to file" },
  {
    pattern: /^git\s+(add|commit|push|pull|merge|rebase|checkout|stash|reset)\b/,
    level: "needs_approval",
    reason: "Git write operation",
  },
  {
    pattern: /^npm\s+(install|uninstall|update|publish)\b/,
    level: "needs_approval",
    reason: "npm package modification",
  },
  {
    pattern: /^pnpm\s+(install|add|remove|update|publish)\b/,
    level: "needs_approval",
    reason: "pnpm package modification",
  },
  {
    pattern: /^yarn\s+(add|remove|upgrade|publish)\b/,
    level: "needs_approval",
    reason: "Yarn package modification",
  },
  {
    pattern: /^pip\s+(install|uninstall)\b/,
    level: "needs_approval",
    reason: "Python package modification",
  },
  {
    pattern: /^brew\s+(install|uninstall|upgrade)\b/,
    level: "needs_approval",
    reason: "Homebrew package modification",
  },
  {
    pattern: /^apt(-get)?\s+(install|remove|purge)\b/,
    level: "needs_approval",
    reason: "APT package modification",
  },
  {
    pattern: /^docker\s+(run|build|push|pull|rm|rmi)\b/,
    level: "needs_approval",
    reason: "Docker operation",
  },
  { pattern: /^sed\s+-i\b/, level: "needs_approval", reason: "In-place file editing" },
];

export const DANGEROUS_COMMANDS: CommandPattern[] = [
  {
    pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--force\s+--recursive|-[a-zA-Z]*f[a-zA-Z]*r)\b/,
    level: "dangerous",
    reason: "Recursive force delete",
  },
  { pattern: /\brm\s+-rf\s+\/\s*$/, level: "dangerous", reason: "Delete root filesystem" },
  { pattern: /\brm\s+-rf\s+~\s*$/, level: "dangerous", reason: "Delete home directory" },
  { pattern: /\bmkfs\b/, level: "dangerous", reason: "Format filesystem" },
  {
    pattern: /\bdd\s+.*if=\/dev\/(zero|random|urandom)/,
    level: "dangerous",
    reason: "Disk destroyer / raw device write",
  },
  { pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/, level: "dangerous", reason: "Fork bomb" },
  { pattern: /\bchmod\s+(-R\s+)?777\b/, level: "dangerous", reason: "World-writable permissions" },
  { pattern: /\bchmod\s+(-R\s+)?000\b/, level: "dangerous", reason: "Remove all permissions" },
  {
    pattern: /\bchown\s+-R\s+root\b/,
    level: "dangerous",
    reason: "Recursive change ownership to root",
  },
  { pattern: />\s*\/dev\/sda/, level: "dangerous", reason: "Write to raw disk device" },
  { pattern: />\s*\/etc\/passwd/, level: "dangerous", reason: "Overwrite password file" },
  { pattern: />\s*\/etc\/shadow/, level: "dangerous", reason: "Overwrite shadow password file" },
  { pattern: /\bshutdown\b/, level: "dangerous", reason: "System shutdown" },
  { pattern: /\breboot\b/, level: "dangerous", reason: "System reboot" },
  { pattern: /\binit\s+0\b/, level: "dangerous", reason: "System halt" },
  { pattern: /\bkill\s+-9\s+-1\b/, level: "dangerous", reason: "Kill all processes" },
  { pattern: /\bkillall\b/, level: "dangerous", reason: "Kill processes by name" },
  { pattern: /\biptables\s+-F\b/, level: "dangerous", reason: "Flush all firewall rules" },
];

export const NETWORK_COMMANDS: CommandPattern[] = [
  { pattern: /^curl\b/, level: "needs_approval", reason: "HTTP request (network access)" },
  { pattern: /^wget\b/, level: "needs_approval", reason: "Download file (network access)" },
  { pattern: /^ssh\b/, level: "needs_approval", reason: "SSH connection" },
  { pattern: /^scp\b/, level: "needs_approval", reason: "Secure copy (network)" },
  { pattern: /^rsync\b/, level: "needs_approval", reason: "Remote sync" },
  { pattern: /^nc\b/, level: "needs_approval", reason: "Netcat (network)" },
  { pattern: /^nmap\b/, level: "needs_approval", reason: "Network scanner" },
  { pattern: /^telnet\b/, level: "needs_approval", reason: "Telnet connection" },
];

export const ALL_PATTERNS: CommandPattern[] = [
  ...DANGEROUS_COMMANDS,
  ...NETWORK_COMMANDS,
  ...WRITE_COMMANDS,
  ...SAFE_COMMANDS,
];
