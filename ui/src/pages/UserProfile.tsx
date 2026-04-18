import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Clock3,
  Coins,
  Hash,
  MessageSquareText,
  Ticket,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { UserProfileDailyPoint, UserProfileWindowStats } from "@paperclipai/shared";
import { Link, useParams } from "@/lib/router";
import { userProfilesApi } from "../api/userProfiles";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { StatusBadge } from "../components/StatusBadge";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { cn, formatCents, formatDate, formatShortDate, formatTokens, issueUrl, providerDisplayName, relativeTime } from "../lib/utils";

const NO_COMPANY = "__none__";

function initials(name: string | null | undefined) {
  const value = name?.trim() || "User";
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
  return value.slice(0, 2).toUpperCase();
}

function totalTokens(stats: Pick<UserProfileWindowStats, "inputTokens" | "cachedInputTokens" | "outputTokens">) {
  return stats.inputTokens + stats.cachedInputTokens + stats.outputTokens;
}

function completionRate(stats: UserProfileWindowStats) {
  if (stats.touchedIssues === 0) return "0%";
  return `${Math.round((stats.completedIssues / stats.touchedIssues) * 100)}%`;
}

function StatPill({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "default" | "green" | "amber" | "blue";
}) {
  return (
    <div
      className={cn(
        "min-w-0 border border-border bg-background p-3",
        tone === "green" && "border-emerald-500/30 bg-emerald-500/5",
        tone === "amber" && "border-amber-500/30 bg-amber-500/5",
        tone === "blue" && "border-sky-500/30 bg-sky-500/5",
      )}
    >
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 truncate text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function WindowPanel({ stats }: { stats: UserProfileWindowStats }) {
  return (
    <div className="border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{stats.label}</h2>
        <Badge variant="outline" className="font-mono">{formatTokens(totalTokens(stats))}</Badge>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatPill icon={Ticket} label="Touched" value={String(stats.touchedIssues)} />
        <StatPill icon={CheckCircle2} label="Done" value={String(stats.completedIssues)} tone="green" />
        <StatPill icon={MessageSquareText} label="Comments" value={String(stats.commentCount)} tone="blue" />
        <StatPill icon={Coins} label="Spend" value={formatCents(stats.costCents)} tone="amber" />
      </div>
      <div className="mt-4 grid grid-cols-3 divide-x divide-border border border-border text-center">
        <div className="p-2">
          <div className="text-xs text-muted-foreground">Created</div>
          <div className="text-sm font-semibold tabular-nums">{stats.createdIssues}</div>
        </div>
        <div className="p-2">
          <div className="text-xs text-muted-foreground">Open</div>
          <div className="text-sm font-semibold tabular-nums">{stats.assignedOpenIssues}</div>
        </div>
        <div className="p-2">
          <div className="text-xs text-muted-foreground">Rate</div>
          <div className="text-sm font-semibold tabular-nums">{completionRate(stats)}</div>
        </div>
      </div>
    </div>
  );
}

function UsageChart({ points }: { points: UserProfileDailyPoint[] }) {
  const maxTokens = Math.max(1, ...points.map((point) => totalTokens(point)));
  const maxActivity = Math.max(1, ...points.map((point) => point.activityCount + point.completedIssues));

  return (
    <section className="border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Two-week signal</h2>
          <p className="text-sm text-muted-foreground">Token pressure, user actions, and completed work by day.</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="size-2 bg-sky-500" /> tokens</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 bg-emerald-500" /> activity</span>
        </div>
      </div>
      <div className="mt-6 grid h-44 grid-cols-[repeat(14,minmax(0,1fr))] items-end gap-1 sm:gap-2">
        {points.map((point) => {
          const tokenHeight = Math.max(6, Math.round((totalTokens(point) / maxTokens) * 100));
          const activityHeight = Math.max(4, Math.round(((point.activityCount + point.completedIssues) / maxActivity) * 72));
          return (
            <div key={point.date} className="group flex h-full min-w-0 flex-col justify-end gap-1">
              <div className="flex h-full items-end justify-center gap-1">
                <div
                  className="w-full max-w-5 border border-sky-500/40 bg-sky-500/20 transition-colors group-hover:bg-sky-500/35"
                  style={{ height: `${tokenHeight}%` }}
                  title={`${formatShortDate(point.date)}: ${formatTokens(totalTokens(point))} tokens`}
                />
                <div
                  className="w-full max-w-3 border border-emerald-500/40 bg-emerald-500/25 transition-colors group-hover:bg-emerald-500/40"
                  style={{ height: `${activityHeight}%` }}
                  title={`${formatShortDate(point.date)}: ${point.activityCount} actions, ${point.completedIssues} completed`}
                />
              </div>
              <div className="truncate text-center text-[10px] text-muted-foreground">{new Date(point.date).getUTCDate()}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function UsageList({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: Array<{
    key: string;
    label: string;
    sublabel: string;
    costCents: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  }>;
}) {
  return (
    <section className="border border-border bg-card p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-4 divide-y divide-border border border-border">
        {rows.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">{empty}</div>
        ) : rows.map((row) => (
          <div key={row.key} className="grid gap-3 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{row.label}</div>
              <div className="truncate text-xs text-muted-foreground">{row.sublabel}</div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs tabular-nums sm:justify-end">
              <Badge variant="outline">{formatTokens(totalTokens(row))}</Badge>
              <Badge variant="secondary">{formatCents(row.costCents)}</Badge>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function UserProfile() {
  const { userSlug = "" } = useParams<{ userSlug: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const companyId = selectedCompanyId ?? NO_COMPANY;

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.userProfile(companyId, userSlug),
    queryFn: () => userProfilesApi.get(companyId, userSlug),
    enabled: !!selectedCompanyId && !!userSlug,
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Users" }, { label: data?.user.name ?? userSlug }]);
  }, [data?.user.name, setBreadcrumbs, userSlug]);

  const allTime = data?.stats.find((entry) => entry.key === "all");
  const last7 = data?.stats.find((entry) => entry.key === "last7");
  const displayName = data?.user.name?.trim() || data?.user.email?.split("@")[0] || "User";

  const agentUsageRows = useMemo(
    () =>
      (data?.topAgents ?? []).map((row) => ({
        key: row.agentId,
        label: row.agentName ?? row.agentId.slice(0, 8),
        sublabel: "Issue-linked token usage",
        costCents: row.costCents,
        inputTokens: row.inputTokens,
        cachedInputTokens: row.cachedInputTokens,
        outputTokens: row.outputTokens,
      })),
    [data?.topAgents],
  );

  const providerUsageRows = useMemo(
    () =>
      (data?.topProviders ?? []).map((row) => ({
        key: `${row.provider}:${row.biller}:${row.model}`,
        label: `${providerDisplayName(row.provider)} / ${row.model}`,
        sublabel: `Billed through ${providerDisplayName(row.biller)}`,
        costCents: row.costCents,
        inputTokens: row.inputTokens,
        cachedInputTokens: row.cachedInputTokens,
        outputTokens: row.outputTokens,
      })),
    [data?.topProviders],
  );

  if (!selectedCompanyId) {
    return <EmptyState icon={UserRound} message="Select a company to view user profiles." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  if (error || !data) {
    return <EmptyState icon={AlertCircle} message="User profile not found for this company." />;
  }

  return (
    <div className="space-y-6">
      <section className="border border-border bg-[linear-gradient(180deg,hsl(var(--card))_0%,hsl(var(--background))_100%)]">
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-7">
          <div className="min-w-0">
            <div className="flex flex-wrap items-start gap-5">
              <Avatar className="size-20 border border-border" size="lg">
                {data.user.image ? <AvatarImage src={data.user.image} alt={displayName} /> : null}
                <AvatarFallback className="text-xl font-semibold">{initials(displayName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="min-w-0 truncate text-3xl font-semibold tracking-normal">{displayName}</h1>
                  <Badge variant="outline">@{data.user.slug}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-sm text-muted-foreground">
                  {data.user.email ? <span className="truncate">{data.user.email}</span> : null}
                  <span>{data.user.membershipRole ?? "member"}</span>
                  <span>{data.user.membershipStatus}</span>
                  <span>joined {formatDate(data.user.joinedAt)}</span>
                </div>
              </div>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatPill icon={Coins} label="All-time tokens" value={formatTokens(allTime ? totalTokens(allTime) : 0)} tone="blue" />
              <StatPill icon={CheckCircle2} label="Completed" value={String(allTime?.completedIssues ?? 0)} tone="green" />
              <StatPill icon={Clock3} label="Open assigned" value={String(allTime?.assignedOpenIssues ?? 0)} tone="amber" />
              <StatPill icon={Activity} label="7-day actions" value={String(last7?.activityCount ?? 0)} />
            </div>
          </div>

          <div className="border border-border bg-background p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Hash className="size-4 text-muted-foreground" />
              Profile ledger
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">All-time spend</span>
                <span className="font-semibold tabular-nums">{formatCents(allTime?.costCents ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Attributed cost events</span>
                <span className="font-semibold tabular-nums">{allTime?.costEventCount ?? 0}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Comments</span>
                <span className="font-semibold tabular-nums">{allTime?.commentCount ?? 0}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Completion rate</span>
                <span className="font-semibold tabular-nums">{allTime ? completionRate(allTime) : "0%"}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        {data.stats.map((entry) => <WindowPanel key={entry.key} stats={entry} />)}
      </div>

      <UsageChart points={data.daily} />

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Recent tasks</h2>
            <Badge variant="outline">{data.recentIssues.length}</Badge>
          </div>
          <div className="mt-4 divide-y divide-border border border-border">
            {data.recentIssues.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No touched tasks yet.</div>
            ) : data.recentIssues.map((issue) => (
              <Link
                key={issue.id}
                to={issueUrl(issue)}
                className="grid gap-2 p-3 transition-colors hover:bg-accent/50 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{issue.identifier ?? issue.id.slice(0, 8)}</div>
                  <div className="truncate text-xs text-muted-foreground">{issue.title}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <StatusBadge status={issue.status} />
                  <span className="text-xs text-muted-foreground">{relativeTime(issue.updatedAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Recent activity</h2>
            <Badge variant="outline">{data.recentActivity.length}</Badge>
          </div>
          <div className="mt-4 divide-y divide-border border border-border">
            {data.recentActivity.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No direct user actions recorded yet.</div>
            ) : data.recentActivity.map((event) => (
              <div key={event.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{event.action.replaceAll("_", " ")}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {event.entityType} - {event.entityId.slice(0, 12)}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">{relativeTime(event.createdAt)}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <UsageList title="Agent attribution" empty="No issue-linked token usage yet." rows={agentUsageRows} />
        <UsageList title="Provider mix" empty="No provider usage attributed yet." rows={providerUsageRows} />
      </div>
    </div>
  );
}
