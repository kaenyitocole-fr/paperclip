import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Link } from "@/lib/router";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { MarkdownBody } from "./MarkdownBody";

export function PlanDocumentPreview({
  issueId,
  issueIdentifier,
  documentKey = "plan",
}: {
  issueId: string;
  issueIdentifier: string | null;
  documentKey?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.issues.document(issueId, documentKey),
    queryFn: () => issuesApi.getDocument(issueId, documentKey),
    staleTime: 30_000,
  });

  const openInTabHref = issueIdentifier
    ? `/issues/${issueIdentifier}#document-${documentKey}`
    : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Plan
        </p>
        {openInTabHref && (
          <Link
            to={openInTabHref}
            target="_blank"
            rel="noreferrer"
            disableIssueQuicklook
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/70 bg-background px-2 py-1 text-xs text-foreground hover:bg-muted"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in new tab
          </Link>
        )}
      </div>
      {isLoading && (
        <div className="rounded-lg border border-border/60 bg-muted/30 px-3.5 py-3 text-xs text-muted-foreground">
          Loading plan…
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-border/60 bg-muted/30 px-3.5 py-3 text-xs text-muted-foreground">
          Couldn’t load plan content. Use “Open in new tab” to read it on the issue page.
        </div>
      )}
      {data && data.body.trim().length > 0 && (
        <>
          <div
            className={
              expanded
                ? "overflow-hidden rounded-lg border border-border/60 bg-background/60 px-3.5 py-3"
                : "relative max-h-96 overflow-y-auto rounded-lg border border-border/60 bg-background/60 px-3.5 py-3"
            }
          >
            <MarkdownBody>{data.body}</MarkdownBody>
          </div>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Collapse" : "Show full plan"}
          </button>
        </>
      )}
      {data && data.body.trim().length === 0 && (
        <div className="rounded-lg border border-border/60 bg-muted/30 px-3.5 py-3 text-xs text-muted-foreground">
          The plan document is empty.
        </div>
      )}
    </div>
  );
}
