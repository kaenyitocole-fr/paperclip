import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import type { Agent } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { agentsApi } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import { useToastActions } from "../context/ToastContext";
import { agentUrl } from "../lib/utils";
import { AuthModeBadge } from "./AuthModeBadge";
import {
  adapterConfigWithMode,
  getClaudeAuthMode,
  isClaudeLocalAdapter,
} from "../lib/claude-auth-mode";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";

type BulkResult = { ok: number; failed: Array<{ id: string; name: string; error: string }> };

async function patchClaudeAgents(
  companyId: string,
  agents: Agent[],
  mode: "api_key" | "subscription",
  key?: string,
): Promise<BulkResult> {
  const claudeAgents = agents.filter((a) => isClaudeLocalAdapter(a.adapterType));
  let ok = 0;
  const failed: BulkResult["failed"] = [];
  for (const agent of claudeAgents) {
    try {
      const nextConfig = adapterConfigWithMode(agent.adapterConfig as Record<string, unknown>, mode, key);
      await agentsApi.update(
        agent.id,
        { adapterConfig: nextConfig, replaceAdapterConfig: true },
        companyId,
      );
      ok++;
    } catch (err) {
      failed.push({
        id: agent.id,
        name: agent.name,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }
  return { ok, failed };
}

export function CompanyAuthHealthCard({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [bulkApiKeyDialogOpen, setBulkApiKeyDialogOpen] = useState(false);
  const [bulkApiKeyDraft, setBulkApiKeyDraft] = useState("");

  const { data: agents = [], isLoading } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
  });

  const { data: runtimeStatesById } = useQuery({
    queryKey: ["agents", "runtime-state-bulk", companyId],
    queryFn: async () => {
      const claudeAgents = agents.filter(
        (a) => isClaudeLocalAdapter(a.adapterType) && a.status !== "terminated",
      );
      const entries = await Promise.all(
        claudeAgents.map(async (agent) => {
          try {
            const state = await agentsApi.runtimeState(agent.id, companyId);
            return [agent.id, state] as const;
          } catch {
            return [agent.id, null] as const;
          }
        }),
      );
      return Object.fromEntries(entries);
    },
    enabled: agents.length > 0,
  });

  const claudeAgents = useMemo(
    () => agents.filter((a) => isClaudeLocalAdapter(a.adapterType) && a.status !== "terminated"),
    [agents],
  );

  const counts = useMemo(() => {
    let api = 0;
    let sub = 0;
    for (const agent of claudeAgents) {
      const mode = getClaudeAuthMode(agent);
      if (mode === "api_key") api++;
      else if (mode === "subscription") sub++;
    }
    return { api, sub, total: claudeAgents.length };
  }, [claudeAgents]);

  const bulkSubscription = useMutation({
    mutationFn: () => patchClaudeAgents(companyId, agents, "subscription"),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
      if (result.failed.length === 0) {
        pushToast({
          title: "Switched to subscription",
          body: `Cleared ANTHROPIC_API_KEY on ${result.ok} agent${result.ok === 1 ? "" : "s"}.`,
          tone: "success",
        });
      } else {
        pushToast({
          title: "Partial switch",
          body: `${result.ok} updated; ${result.failed.length} failed: ${result.failed.map((f) => f.name).join(", ")}`,
          tone: "error",
        });
      }
    },
    onError: (err) => {
      pushToast({
        title: "Bulk switch failed",
        body: err instanceof Error ? err.message : "Unknown error",
        tone: "error",
      });
    },
  });

  const bulkApiKey = useMutation({
    mutationFn: (key: string) => patchClaudeAgents(companyId, agents, "api_key", key),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
      setBulkApiKeyDialogOpen(false);
      setBulkApiKeyDraft("");
      if (result.failed.length === 0) {
        pushToast({
          title: "Switched to API key",
          body: `Set ANTHROPIC_API_KEY on ${result.ok} agent${result.ok === 1 ? "" : "s"}.`,
          tone: "success",
        });
      } else {
        pushToast({
          title: "Partial switch",
          body: `${result.ok} updated; ${result.failed.length} failed: ${result.failed.map((f) => f.name).join(", ")}`,
          tone: "error",
        });
      }
    },
    onError: (err) => {
      pushToast({
        title: "Bulk switch failed",
        body: err instanceof Error ? err.message : "Unknown error",
        tone: "error",
      });
    },
  });

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Loading agents…</p>;
  }

  if (claudeAgents.length === 0) {
    return (
      <div className="rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
        No Claude (claude_local) agents in this company.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3 rounded-md border border-border px-4 py-4">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span>
            <span className="font-medium">{counts.sub}</span>{" "}
            <span className="text-muted-foreground">on subscription</span>
          </span>
          <span>
            <span className="font-medium">{counts.api}</span>{" "}
            <span className="text-muted-foreground">on API key</span>
          </span>
          <span className="text-xs text-muted-foreground">
            ({counts.total} Claude agent{counts.total === 1 ? "" : "s"})
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={bulkSubscription.isPending || counts.sub === counts.total}
            onClick={() => {
              const target = counts.api;
              if (target === 0) return;
              if (!window.confirm(`Switch ${target} Claude agent${target === 1 ? "" : "s"} to subscription mode? This clears ANTHROPIC_API_KEY from each agent's env.`)) return;
              bulkSubscription.mutate();
            }}
          >
            {bulkSubscription.isPending ? "Switching…" : "Use subscription for all"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={bulkApiKey.isPending}
            onClick={() => setBulkApiKeyDialogOpen(true)}
          >
            Use one API key for all
          </Button>
        </div>

        <div className="rounded-md border border-border/60 overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-2.5 py-1.5 font-medium">Agent</th>
                <th className="px-2.5 py-1.5 font-medium">Mode</th>
                <th className="px-2.5 py-1.5 font-medium">Last error</th>
              </tr>
            </thead>
            <tbody>
              {claudeAgents.map((agent) => {
                const runtimeState = runtimeStatesById?.[agent.id] ?? null;
                const lastError = runtimeState?.lastError ?? null;
                return (
                  <tr key={agent.id} className="border-t border-border/40">
                    <td className="px-2.5 py-1.5">
                      <Link to={agentUrl(agent)} className="hover:underline">
                        {agent.name}
                      </Link>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <AuthModeBadge agent={agent} />
                    </td>
                    <td className="px-2.5 py-1.5 text-muted-foreground">
                      {lastError ? (
                        <span
                          className="text-red-600 dark:text-red-400 break-words line-clamp-2"
                          title={lastError}
                        >
                          {lastError}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={bulkApiKeyDialogOpen} onOpenChange={setBulkApiKeyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Use one API key for all Claude agents</DialogTitle>
            <DialogDescription>
              Sets <span className="font-mono">ANTHROPIC_API_KEY</span> on every Claude agent in this company to the value below. Existing keys will be overwritten.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <input
              type="password"
              className={inputClass}
              placeholder="sk-ant-..."
              value={bulkApiKeyDraft}
              onChange={(e) => setBulkApiKeyDraft(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {claudeAgents.length} Claude agent{claudeAgents.length === 1 ? "" : "s"} will be updated.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkApiKeyDialogOpen(false)} disabled={bulkApiKey.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const key = bulkApiKeyDraft.trim();
                if (!key) return;
                bulkApiKey.mutate(key);
              }}
              disabled={bulkApiKey.isPending || bulkApiKeyDraft.trim().length === 0}
            >
              {bulkApiKey.isPending ? "Applying…" : "Apply to all"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
