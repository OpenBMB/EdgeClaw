export interface SecretRule {
  id: string;
  pattern: RegExp;
  description: string;
}

export const BUILTIN_RULES: SecretRule[] = [
  // AWS
  { id: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/, description: "AWS Access Key ID" },
  {
    id: "aws-secret-key",
    pattern: /\b[A-Za-z0-9/+=]{40}\b(?=.*aws|.*secret)/i,
    description: "AWS Secret Access Key",
  },

  // GitHub
  {
    id: "github-pat",
    pattern: /\bghp_[A-Za-z0-9]{36}\b/,
    description: "GitHub Personal Access Token",
  },
  { id: "github-oauth", pattern: /\bgho_[A-Za-z0-9]{36}\b/, description: "GitHub OAuth Token" },
  { id: "github-app", pattern: /\bghu_[A-Za-z0-9]{36}\b/, description: "GitHub App User Token" },
  {
    id: "github-fine-grained",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{82}\b/,
    description: "GitHub Fine-Grained PAT",
  },

  // OpenAI
  {
    id: "openai-key",
    pattern: /\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}\b/,
    description: "OpenAI API Key (legacy)",
  },
  {
    id: "openai-project-key",
    pattern: /\bsk-proj-[A-Za-z0-9_-]{40,}\b/,
    description: "OpenAI Project API Key",
  },

  // Anthropic
  {
    id: "anthropic-key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{40,}\b/,
    description: "Anthropic API Key",
  },

  // Google
  { id: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, description: "Google API Key" },
  {
    id: "gcp-service-account",
    pattern: /"type"\s*:\s*"service_account"/,
    description: "GCP Service Account JSON",
  },

  // Slack
  {
    id: "slack-bot-token",
    pattern: /\bxoxb-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24}\b/,
    description: "Slack Bot Token",
  },
  {
    id: "slack-user-token",
    pattern: /\bxoxp-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24,34}\b/,
    description: "Slack User Token",
  },
  {
    id: "slack-webhook",
    pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/,
    description: "Slack Webhook URL",
  },

  // Stripe
  {
    id: "stripe-secret",
    pattern: /\bsk_live_[A-Za-z0-9]{24,}\b/,
    description: "Stripe Secret Key",
  },
  {
    id: "stripe-publishable",
    pattern: /\bpk_live_[A-Za-z0-9]{24,}\b/,
    description: "Stripe Publishable Key",
  },

  // Twilio
  { id: "twilio-api-key", pattern: /\bSK[0-9a-fA-F]{32}\b/, description: "Twilio API Key" },

  // SendGrid
  {
    id: "sendgrid-key",
    pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/,
    description: "SendGrid API Key",
  },

  // Mailgun
  { id: "mailgun-key", pattern: /\bkey-[0-9a-zA-Z]{32}\b/, description: "Mailgun API Key" },

  // npm
  { id: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/, description: "npm Access Token" },

  // Private Key
  {
    id: "private-key-pem",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    description: "Private Key (PEM)",
  },

  // JWT
  {
    id: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    description: "JSON Web Token",
  },

  // Generic high-entropy (hex 32+ chars, often API keys)
  {
    id: "generic-hex-secret",
    pattern: /\b[0-9a-f]{32,64}\b(?=.*(?:key|token|secret|password|api))/i,
    description: "Generic hex secret (near key/token keyword)",
  },

  // Database URLs
  {
    id: "postgres-url",
    pattern: /postgres(?:ql)?:\/\/[^:]+:[^@]+@[^/]+/,
    description: "PostgreSQL connection string",
  },
  {
    id: "mysql-url",
    pattern: /mysql:\/\/[^:]+:[^@]+@[^/]+/,
    description: "MySQL connection string",
  },
  {
    id: "mongodb-url",
    pattern: /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@[^/]+/,
    description: "MongoDB connection string",
  },
  {
    id: "redis-url",
    pattern: /redis:\/\/[^:]*:[^@]+@[^/]+/,
    description: "Redis connection string",
  },

  // Heroku
  {
    id: "heroku-key",
    pattern:
      /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b(?=.*heroku)/i,
    description: "Heroku API Key",
  },

  // Azure
  {
    id: "azure-storage-key",
    pattern: /DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[^;]+/,
    description: "Azure Storage Connection String",
  },
];

export interface ScanMatch {
  ruleId: string;
  description: string;
  match: string;
  index: number;
}

export function scanForSecrets(
  text: string,
  rules: SecretRule[],
  enabledRuleIds?: string[],
): ScanMatch[] {
  const active =
    enabledRuleIds && enabledRuleIds.length > 0
      ? rules.filter((r) => enabledRuleIds.includes(r.id))
      : rules;

  const matches: ScanMatch[] = [];
  for (const rule of active) {
    const re = new RegExp(
      rule.pattern.source,
      rule.pattern.flags + (rule.pattern.flags.includes("g") ? "" : "g"),
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push({
        ruleId: rule.id,
        description: rule.description,
        match: m[0].length > 20 ? m[0].slice(0, 10) + "..." + m[0].slice(-5) : m[0],
        index: m.index,
      });
    }
  }
  return matches;
}
