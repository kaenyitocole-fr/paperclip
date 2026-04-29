import { describe, it, expect } from "vitest";
import type { Agent } from "@paperclipai/shared";
import {
  getClaudeAuthMode,
  getAnthropicApiKeyLast4,
  withAnthropicApiKey,
  withoutAnthropicApiKey,
  adapterConfigWithMode,
} from "./claude-auth-mode";

function agent(overrides: Partial<Pick<Agent, "adapterType" | "adapterConfig">>): Pick<Agent, "adapterType" | "adapterConfig"> {
  return {
    adapterType: "claude_local",
    adapterConfig: {},
    ...overrides,
  };
}

describe("getClaudeAuthMode", () => {
  it("returns n/a for non-claude_local adapters", () => {
    expect(getClaudeAuthMode(agent({ adapterType: "codex_local" }))).toBe("n/a");
  });

  it("returns subscription when env is missing", () => {
    expect(getClaudeAuthMode(agent({ adapterConfig: {} }))).toBe("subscription");
  });

  it("returns subscription when ANTHROPIC_API_KEY is absent", () => {
    expect(getClaudeAuthMode(agent({ adapterConfig: { env: { OTHER: { type: "plain", value: "x" } } } }))).toBe(
      "subscription",
    );
  });

  it("returns subscription when ANTHROPIC_API_KEY is empty plain binding", () => {
    expect(
      getClaudeAuthMode(agent({ adapterConfig: { env: { ANTHROPIC_API_KEY: { type: "plain", value: "" } } } })),
    ).toBe("subscription");
  });

  it("returns api_key when ANTHROPIC_API_KEY has a plain value", () => {
    expect(
      getClaudeAuthMode(
        agent({ adapterConfig: { env: { ANTHROPIC_API_KEY: { type: "plain", value: "sk-ant-abcd" } } } }),
      ),
    ).toBe("api_key");
  });

  it("returns api_key when ANTHROPIC_API_KEY is a secret_ref", () => {
    expect(
      getClaudeAuthMode(
        agent({
          adapterConfig: {
            env: { ANTHROPIC_API_KEY: { type: "secret_ref", secretId: "sec-1" } },
          },
        }),
      ),
    ).toBe("api_key");
  });

  it("returns api_key when ANTHROPIC_API_KEY is a legacy plain string", () => {
    expect(
      getClaudeAuthMode(agent({ adapterConfig: { env: { ANTHROPIC_API_KEY: "sk-ant-abcd" } } })),
    ).toBe("api_key");
  });
});

describe("getAnthropicApiKeyLast4", () => {
  it("returns last 4 chars of plain binding", () => {
    expect(
      getAnthropicApiKeyLast4(
        agent({ adapterConfig: { env: { ANTHROPIC_API_KEY: { type: "plain", value: "sk-ant-12345678" } } } }),
      ),
    ).toBe("5678");
  });

  it("returns null when key is missing", () => {
    expect(getAnthropicApiKeyLast4(agent({ adapterConfig: {} }))).toBeNull();
  });

  it("returns null when key is a secret_ref (no plaintext known to UI)", () => {
    expect(
      getAnthropicApiKeyLast4(
        agent({ adapterConfig: { env: { ANTHROPIC_API_KEY: { type: "secret_ref", secretId: "x" } } } }),
      ),
    ).toBeNull();
  });

  it("returns null for keys shorter than 4 chars", () => {
    expect(
      getAnthropicApiKeyLast4(
        agent({ adapterConfig: { env: { ANTHROPIC_API_KEY: { type: "plain", value: "abc" } } } }),
      ),
    ).toBeNull();
  });
});

describe("withAnthropicApiKey / withoutAnthropicApiKey", () => {
  it("adds the key as a plain binding", () => {
    const result = withAnthropicApiKey({ FOO: { type: "plain", value: "bar" } }, "sk-1");
    expect(result.ANTHROPIC_API_KEY).toEqual({ type: "plain", value: "sk-1" });
    expect(result.FOO).toEqual({ type: "plain", value: "bar" });
  });

  it("removes the key, leaving other env intact", () => {
    const result = withoutAnthropicApiKey({
      FOO: { type: "plain", value: "bar" },
      ANTHROPIC_API_KEY: { type: "plain", value: "sk-1" },
    });
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result.FOO).toEqual({ type: "plain", value: "bar" });
  });

  it("handles null/undefined env input", () => {
    expect(withAnthropicApiKey(null, "sk-1").ANTHROPIC_API_KEY).toEqual({ type: "plain", value: "sk-1" });
    expect(withoutAnthropicApiKey(undefined)).toEqual({});
  });
});

describe("adapterConfigWithMode", () => {
  it("clears the key when switching to subscription", () => {
    const result = adapterConfigWithMode(
      { env: { ANTHROPIC_API_KEY: { type: "plain", value: "sk-1" }, OTHER: "y" }, cwd: "/x" },
      "subscription",
    );
    expect((result.env as Record<string, unknown>).ANTHROPIC_API_KEY).toBeUndefined();
    expect((result.env as Record<string, unknown>).OTHER).toBe("y");
    expect(result.cwd).toBe("/x");
  });

  it("writes the key when switching to api_key", () => {
    const result = adapterConfigWithMode({ env: {} }, "api_key", "sk-2");
    expect((result.env as Record<string, unknown>).ANTHROPIC_API_KEY).toEqual({ type: "plain", value: "sk-2" });
  });
});
