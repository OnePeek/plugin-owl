// Secret shapes, modelled on the gitleaks default rule set (MIT, https://github.com/gitleaks/gitleaks). A match anywhere
// in a summary holds the record (rule E2); the same shapes redact the model's INPUT so a secret never reaches the
// summariser at all. Patterns are linear-time on purpose (no nested quantifiers) so the scan cannot be made slow.

export interface SecretRule {
  id: string;
  re: RegExp;
}

export const SECRET_RULES: SecretRule[] = [
  { id: "private-key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { id: "aws-access-key", re: /\b(?:AKIA|ASIA|ABIA|ACCA|A3T[A-Z0-9])[A-Z2-7]{16}\b/ },
  { id: "aws-secret", re: /\baws.{0,20}(?:secret|key).{0,5}[=:]\s*["']?[A-Za-z0-9/+=]{40}\b/i },
  { id: "github-pat", re: /\bgh[pousr]_[A-Za-z0-9]{30,255}\b/ },
  { id: "github-fine-pat", re: /\bgithub_pat_[A-Za-z0-9_]{50,255}\b/ },
  { id: "gitlab-pat", re: /\bglpat-[A-Za-z0-9_-]{20}\b/ },
  // round 3: gitleaks reads Slack tokens with no word boundary in front (tokenxoxb-...), legacy workspace tokens from 8
  // characters and refresh tokens (xoxe); the app-level token is xapp-
  { id: "slack-token", re: /xox[abposre]-[A-Za-z0-9-]{8,}/ },
  { id: "slack-app-token", re: /xapp-\d-[A-Za-z0-9]+-\d+-[A-Za-z0-9]+/i },
  { id: "slack-webhook", re: /hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/ },
  { id: "stripe-key", re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { id: "stripe-webhook", re: /\bwhsec_[A-Za-z0-9]{24,}\b/ },
  { id: "google-api-key", re: /\bAIza[A-Za-z0-9_-]{35}\b/ },
  { id: "google-oauth-secret", re: /\bGOCSPX-[A-Za-z0-9_-]{28}\b/ },
  { id: "gcp-service-account", re: /"type"\s*:\s*"service_account"/ },
  { id: "openai-key", re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}\b/ },
  { id: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { id: "npm-token", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: "pypi-token", re: /\bpypi-[A-Za-z0-9_-]{50,}\b/ },
  { id: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/ },
  { id: "twilio", re: /\b(?:AC|SK)[0-9a-f]{32}\b/ },
  // round 3: the gitleaks shape is SG. and 66 characters of letters, digits, = _ - and . (a key ending in = or without the
  // inner dot was missed by the two-part form alone)
  { id: "sendgrid", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b|\bSG\.[A-Za-z0-9=_.-]{66}/ },
  { id: "mailgun", re: /\bkey-[0-9a-f]{32}\b/ },
  { id: "shopify", re: /\bshp(?:at|ca|pa|ss)_[0-9a-f]{32}\b/ },
  { id: "digitalocean", re: /\bdo[opr]_v1_[0-9a-f]{64}\b/ },
  { id: "heroku-uuid-key", re: /\bheroku.{0,20}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
  { id: "azure-storage", re: /\bAccountKey=[A-Za-z0-9+/=]{40,}/ },
  { id: "db-url-credentials", re: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s/:@]{1,64}:[^\s/@]{1,128}@/i },
  { id: "bearer", re: /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{20,}/ },
  { id: "basic-auth", re: /\b[Bb]asic\s+[A-Za-z0-9+/=]{16,}/ },
  { id: "generic-assignment", re: /\b(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|credential|auth)[A-Za-z0-9_-]{0,20}\s*[=:]\s*["']?[A-Za-z0-9/+_=.-]{8,}/i },
  { id: "dotenv-line", re: /^[A-Z][A-Z0-9_]{2,}=[^\s]{6,}$/m },
  { id: "ssh-key-body", re: /\bssh-(?:rsa|ed25519|dss)\s+[A-Za-z0-9+/=]{40,}/ },
  { id: "age-key", re: /\bAGE-SECRET-KEY-1[A-Z0-9]{50,}\b/ },
  { id: "hashicorp-vault", re: /\bhv[sbr]\.[A-Za-z0-9_-]{20,}\b/ },
  { id: "cloudflare", re: /\bcf[a-z]{0,3}[_-]?(?:token|key)\s*[=:]\s*["']?[A-Za-z0-9_-]{30,}/i },
  { id: "linear", re: /\blin_api_[A-Za-z0-9]{30,}\b/ },
  { id: "doppler", re: /\bdp\.(?:pt|st|sa|ct)\.[A-Za-z0-9]{40,}\b/ },
];

export function matchSecret(text: string): string | undefined {
  for (const r of SECRET_RULES) if (r.re.test(text)) return r.id;
  return undefined;
}
