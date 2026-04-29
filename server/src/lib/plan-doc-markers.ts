export type PlanReviewStatus = "approved" | "changes-requested" | "pending" | null;
export type PlanComplexity = "low" | "medium" | "high" | null;

export interface PlanDocMarkers {
  reviewStatus: PlanReviewStatus;
  complexity: PlanComplexity;
  planReviewerNotes: string | null;
  hasUiSection: boolean;
}

interface Section {
  heading: string;
  body: string;
}

function splitSections(body: string): Section[] {
  const lines = body.split(/\r?\n/);
  const sections: Section[] = [];
  let currentHeading: string | null = null;
  let currentBody: string[] = [];
  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (currentHeading != null) {
        sections.push({ heading: currentHeading, body: currentBody.join("\n").trim() });
      }
      currentHeading = match[1].toLowerCase().trim();
      currentBody = [];
    } else if (currentHeading != null) {
      currentBody.push(line);
    }
  }
  if (currentHeading != null) {
    sections.push({ heading: currentHeading, body: currentBody.join("\n").trim() });
  }
  return sections;
}

function findSection(sections: Section[], headingNeedle: string): Section | null {
  return (
    sections.find((section) => section.heading === headingNeedle) ??
    sections.find((section) => section.heading.startsWith(`${headingNeedle}:`)) ??
    sections.find((section) => section.heading.startsWith(`${headingNeedle} `)) ??
    null
  );
}

function readReviewStatus(section: Section | null): PlanReviewStatus {
  if (!section) return null;
  // Heading might be "plan review: approved" — check there first.
  const headingTail = section.heading.replace(/^plan review[:\s]*/, "").trim();
  const all = `${headingTail}\n${section.body}`.toLowerCase();
  const statusLine = /^\s*status\s*[:\-]?\s*(approved|changes[-_ ]requested|pending)/m.exec(all);
  if (statusLine) {
    const value = statusLine[1].replace(/[_ ]/g, "-");
    if (value === "approved") return "approved";
    if (value === "changes-requested") return "changes-requested";
    return "pending";
  }
  if (/\bapproved\b/.test(all)) return "approved";
  if (/\bchanges[-_ ]?requested\b/.test(all)) return "changes-requested";
  return null;
}

function readComplexity(section: Section | null): PlanComplexity {
  if (!section) return null;
  const headingTail = section.heading.replace(/^complexity[:\s]*/, "").trim();
  const all = `${headingTail}\n${section.body}`.toLowerCase();
  if (/\bhigh\b/.test(all)) return "high";
  if (/\bmedium\b/.test(all)) return "medium";
  if (/\blow\b/.test(all)) return "low";
  return null;
}

export function parsePlanDocMarkers(body: string | null | undefined): PlanDocMarkers {
  if (typeof body !== "string" || body.length === 0) {
    return { reviewStatus: null, complexity: null, planReviewerNotes: null, hasUiSection: false };
  }
  const sections = splitSections(body);
  const reviewSection = findSection(sections, "plan review");
  const complexitySection = findSection(sections, "complexity");
  const uiSection =
    findSection(sections, "ui") ??
    findSection(sections, "design") ??
    findSection(sections, "ui work") ??
    findSection(sections, "design notes") ??
    null;
  const notesBody = reviewSection
    ? reviewSection.body.replace(/^\s*status\s*[:\-]?[^\n]*\n?/im, "").trim()
    : null;
  return {
    reviewStatus: readReviewStatus(reviewSection),
    complexity: readComplexity(complexitySection),
    planReviewerNotes: notesBody && notesBody.length > 0 ? notesBody : null,
    hasUiSection: uiSection != null,
  };
}

export function isKaenyApprovalEligible(markers: PlanDocMarkers): boolean {
  return (
    markers.reviewStatus === "approved" &&
    (markers.complexity === "medium" || markers.complexity === "high")
  );
}
