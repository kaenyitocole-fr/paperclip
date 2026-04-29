import { Key, UserRound } from "lucide-react";
import type { Agent } from "@paperclipai/shared";
import { Badge } from "@/components/ui/badge";
import { getClaudeAuthMode } from "../lib/claude-auth-mode";
import { cn } from "../lib/utils";

export function AuthModeBadge({
  agent,
  className,
}: {
  agent: Pick<Agent, "adapterType" | "adapterConfig">;
  className?: string;
}) {
  const mode = getClaudeAuthMode(agent);
  if (mode === "n/a") return null;
  if (mode === "api_key") {
    return (
      <Badge variant="outline" className={cn("text-[10px] gap-1 py-0 h-5", className)} title="Uses ANTHROPIC_API_KEY from adapter env">
        <Key className="h-2.5 w-2.5" />
        API
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={cn("text-[10px] gap-1 py-0 h-5", className)} title="Uses the local Claude Code subscription session">
      <UserRound className="h-2.5 w-2.5" />
      Subscription
    </Badge>
  );
}
