// The one place that reads the environment as a whole (lint: a bare `process.env` is allowed only here). Each list names
// exactly what a child process needs; every name is on the lint allow-list (LLD §13).

/** What the headless summariser needs to find `claude` and the person's own sign-in: subscription, API key, Bedrock or Vertex. */
export const SUMMARISER_ENV = [
  "PATH", "HOME", "USER", "LOGNAME", "USERPROFILE", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "APPDATA", "LOCALAPPDATA", "CLAUDE_CONFIG_DIR",
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK", "AWS_PROFILE", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_BEARER_TOKEN_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX", "ANTHROPIC_VERTEX_PROJECT_ID", "CLOUD_ML_REGION", "GOOGLE_APPLICATION_CREDENTIALS",
] as const;

/** The background drain started by the hook: the summariser's needs, the key store's session bus (Linux secret-tool needs
 * DBUS_SESSION_BUS_ADDRESS and XDG_RUNTIME_DIR to reach the login keyring), and the off switches. */
export const DRAIN_ENV = [...SUMMARISER_ENV, "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR", "DO_NOT_TRACK", "ONEPEEK_WORKLOG"] as const;

/** OS key store commands (`security`, `secret-tool`, PowerShell DPAPI). */
export const KEYSTORE_ENV = ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"] as const;

export function pickEnv(names: readonly string[], src: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of names) if (typeof src[k] === "string") env[k] = src[k] as string;
  return env;
}
