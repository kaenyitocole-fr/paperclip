import type { Agent, EnvBinding } from "@paperclipai/shared";

export type ClaudeAuthMode = "api_key" | "subscription" | "n/a";

export const ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY";

export function isClaudeLocalAdapter(adapterType: string): boolean {
  return adapterType === "claude_local";
}

function readEnvRecord(adapterConfig: unknown): Record<string, EnvBinding> | null {
  if (!adapterConfig || typeof adapterConfig !== "object") return null;
  const env = (adapterConfig as { env?: unknown }).env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return null;
  return env as Record<string, EnvBinding>;
}

function bindingPlainValue(binding: EnvBinding | undefined): string | null {
  if (binding === undefined) return null;
  if (typeof binding === "string") return binding;
  if (typeof binding === "object" && binding !== null && "type" in binding) {
    if (binding.type === "plain" && typeof binding.value === "string") return binding.value;
    if (binding.type === "secret_ref") return null;
  }
  return null;
}

export function getClaudeAuthMode(agent: Pick<Agent, "adapterType" | "adapterConfig">): ClaudeAuthMode {
  if (!isClaudeLocalAdapter(agent.adapterType)) return "n/a";
  const env = readEnvRecord(agent.adapterConfig);
  const binding = env?.[ANTHROPIC_API_KEY_ENV];
  if (binding === undefined) return "subscription";
  if (typeof binding === "object" && binding !== null && "type" in binding && binding.type === "secret_ref") {
    return "api_key";
  }
  const plain = bindingPlainValue(binding);
  return plain && plain.length > 0 ? "api_key" : "subscription";
}

export function getAnthropicApiKeyLast4(agent: Pick<Agent, "adapterConfig">): string | null {
  const env = readEnvRecord(agent.adapterConfig);
  const binding = env?.[ANTHROPIC_API_KEY_ENV];
  const plain = bindingPlainValue(binding);
  if (!plain || plain.length < 4) return null;
  return plain.slice(-4);
}

export function withAnthropicApiKey(
  env: Record<string, EnvBinding> | null | undefined,
  key: string,
): Record<string, EnvBinding> {
  const next: Record<string, EnvBinding> = { ...(env ?? {}) };
  next[ANTHROPIC_API_KEY_ENV] = { type: "plain", value: key };
  return next;
}

export function withoutAnthropicApiKey(
  env: Record<string, EnvBinding> | null | undefined,
): Record<string, EnvBinding> {
  const next: Record<string, EnvBinding> = { ...(env ?? {}) };
  delete next[ANTHROPIC_API_KEY_ENV];
  return next;
}

export function getAdapterEnv(adapterConfig: unknown): Record<string, EnvBinding> {
  return readEnvRecord(adapterConfig) ?? {};
}

export function adapterConfigWithMode(
  adapterConfig: Record<string, unknown> | undefined,
  mode: "api_key" | "subscription",
  key?: string,
): Record<string, unknown> {
  const existing = adapterConfig ?? {};
  const env = readEnvRecord(existing) ?? {};
  const nextEnv =
    mode === "subscription"
      ? withoutAnthropicApiKey(env)
      : withAnthropicApiKey(env, key ?? "");
  return { ...existing, env: nextEnv };
}
