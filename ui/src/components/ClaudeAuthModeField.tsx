import { useEffect, useMemo, useState } from "react";
import type { EnvBinding } from "@paperclipai/shared";
import { Eye, EyeOff } from "lucide-react";
import { Field } from "./agent-config-primitives";
import { Button } from "@/components/ui/button";
import { cn } from "../lib/utils";
import {
  ANTHROPIC_API_KEY_ENV,
  withAnthropicApiKey,
  withoutAnthropicApiKey,
} from "../lib/claude-auth-mode";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";

function readKey(env: Record<string, EnvBinding>): {
  mode: "api_key" | "subscription";
  knownPlainValue: string | null;
  isSecretRef: boolean;
} {
  const binding = env[ANTHROPIC_API_KEY_ENV];
  if (binding === undefined) return { mode: "subscription", knownPlainValue: null, isSecretRef: false };
  if (typeof binding === "string") {
    return binding ? { mode: "api_key", knownPlainValue: binding, isSecretRef: false } : { mode: "subscription", knownPlainValue: null, isSecretRef: false };
  }
  if (typeof binding === "object" && binding !== null && "type" in binding) {
    if (binding.type === "secret_ref") return { mode: "api_key", knownPlainValue: null, isSecretRef: true };
    if (binding.type === "plain") {
      const value = typeof binding.value === "string" ? binding.value : "";
      return value ? { mode: "api_key", knownPlainValue: value, isSecretRef: false } : { mode: "subscription", knownPlainValue: null, isSecretRef: false };
    }
  }
  return { mode: "subscription", knownPlainValue: null, isSecretRef: false };
}

export function ClaudeAuthModeField({
  value,
  onChange,
}: {
  value: Record<string, EnvBinding>;
  onChange: (env: Record<string, EnvBinding> | undefined) => void;
}) {
  const persisted = useMemo(() => readKey(value), [value]);
  const [draftKey, setDraftKey] = useState(persisted.knownPlainValue ?? "");
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    setDraftKey(persisted.knownPlainValue ?? "");
  }, [persisted.knownPlainValue]);

  const last4 =
    persisted.knownPlainValue && persisted.knownPlainValue.length >= 4
      ? persisted.knownPlainValue.slice(-4)
      : null;

  const setMode = (next: "api_key" | "subscription") => {
    if (next === persisted.mode) return;
    if (next === "subscription") {
      onChange(withoutAnthropicApiKey(value));
    } else {
      onChange(withAnthropicApiKey(value, draftKey));
    }
  };

  const commitKey = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      onChange(withoutAnthropicApiKey(value));
      return;
    }
    onChange(withAnthropicApiKey(value, trimmed));
  };

  return (
    <Field
      label="Auth mode"
      hint="API key sets ANTHROPIC_API_KEY in the adapter env. Subscription clears it so Claude Code falls back to the local logged-in session."
    >
      <div className="space-y-2">
        <div role="radiogroup" className="flex flex-col gap-1.5">
          <ModeOption
            label="Claude Code subscription"
            description="Uses the local Claude Code session (Pro/Max subscription, 5-hour rolling windows)."
            checked={persisted.mode === "subscription"}
            onSelect={() => setMode("subscription")}
          />
          <ModeOption
            label="API key"
            description="Uses ANTHROPIC_API_KEY from this agent's adapter env."
            checked={persisted.mode === "api_key"}
            onSelect={() => setMode("api_key")}
          />
        </div>

        {persisted.mode === "api_key" && (
          <div className="space-y-1.5 pl-5">
            {persisted.isSecretRef ? (
              <p className="text-xs text-muted-foreground">
                Bound to a secret reference. Edit it in <span className="font-mono">Environment variables</span> below.
              </p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <input
                    type={reveal ? "text" : "password"}
                    className={inputClass}
                    placeholder={last4 ? `••••${last4}` : "sk-ant-..."}
                    value={draftKey}
                    onChange={(e) => setDraftKey(e.target.value)}
                    onBlur={() => commitKey(draftKey)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() => setReveal((r) => !r)}
                    title={reveal ? "Hide key" : "Show key"}
                  >
                    {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                {last4 && (
                  <p className="text-xs text-muted-foreground">
                    Saved key ends in <span className="font-mono">{last4}</span>.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Field>
  );
}

function ModeOption({
  label,
  description,
  checked,
  onSelect,
}: {
  label: string;
  description: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-2 cursor-pointer rounded-md border px-2.5 py-1.5 transition-colors",
        checked ? "border-primary/40 bg-primary/5" : "border-border hover:bg-accent/30",
      )}
    >
      <input
        type="radio"
        className="mt-0.5"
        checked={checked}
        onChange={onSelect}
      />
      <div className="space-y-0.5">
        <p className="text-xs font-medium">{label}</p>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
    </label>
  );
}
