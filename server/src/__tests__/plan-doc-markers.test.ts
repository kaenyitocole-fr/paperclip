import { describe, expect, it } from "vitest";
import {
  isKaenyApprovalEligible,
  parsePlanDocMarkers,
} from "../lib/plan-doc-markers.js";

describe("parsePlanDocMarkers", () => {
  it("returns nulls for empty body", () => {
    expect(parsePlanDocMarkers("")).toEqual({
      reviewStatus: null,
      complexity: null,
      planReviewerNotes: null,
      hasUiSection: false,
    });
    expect(parsePlanDocMarkers(null)).toEqual({
      reviewStatus: null,
      complexity: null,
      planReviewerNotes: null,
      hasUiSection: false,
    });
  });

  it("reads approved review status and medium complexity", () => {
    const body = `# Plan\n\n## complexity\nmedium\n\n## plan review\nStatus: approved\n\nLooks good, ship it.\n`;
    const result = parsePlanDocMarkers(body);
    expect(result.reviewStatus).toBe("approved");
    expect(result.complexity).toBe("medium");
    expect(result.planReviewerNotes).toBe("Looks good, ship it.");
    expect(result.hasUiSection).toBe(false);
  });

  it("reads changes-requested status and high complexity", () => {
    const body = `## complexity: high\n\n## plan review\nStatus: changes-requested\n\nNeeds more detail on step 2.`;
    const result = parsePlanDocMarkers(body);
    expect(result.reviewStatus).toBe("changes-requested");
    expect(result.complexity).toBe("high");
    expect(result.planReviewerNotes).toBe("Needs more detail on step 2.");
  });

  it("treats low complexity as low", () => {
    const body = `## complexity\nlow\n\n## plan review\nStatus: approved`;
    const result = parsePlanDocMarkers(body);
    expect(result.complexity).toBe("low");
    expect(result.reviewStatus).toBe("approved");
  });

  it("detects UI section", () => {
    const body = `## complexity: medium\n\n## ui\nNeeds a new dialog\n\n## plan review\nStatus: approved`;
    expect(parsePlanDocMarkers(body).hasUiSection).toBe(true);
  });

  it("treats design heading as UI section", () => {
    const body = `## complexity: medium\n\n## design notes\nspec\n\n## plan review\nStatus: approved`;
    expect(parsePlanDocMarkers(body).hasUiSection).toBe(true);
  });

  it("returns null when sections missing", () => {
    expect(parsePlanDocMarkers("# Plan\n\nJust a plan.").reviewStatus).toBeNull();
    expect(parsePlanDocMarkers("# Plan\n\nJust a plan.").complexity).toBeNull();
  });

  it("is case insensitive on heading and value", () => {
    const body = `## Complexity: MEDIUM\n\n## Plan Review\nstatus: APPROVED`;
    const result = parsePlanDocMarkers(body);
    expect(result.complexity).toBe("medium");
    expect(result.reviewStatus).toBe("approved");
  });
});

describe("isKaenyApprovalEligible", () => {
  it("is true for approved + medium", () => {
    expect(
      isKaenyApprovalEligible({
        reviewStatus: "approved",
        complexity: "medium",
        planReviewerNotes: null,
        hasUiSection: false,
      }),
    ).toBe(true);
  });

  it("is true for approved + high", () => {
    expect(
      isKaenyApprovalEligible({
        reviewStatus: "approved",
        complexity: "high",
        planReviewerNotes: null,
        hasUiSection: false,
      }),
    ).toBe(true);
  });

  it("is false for low complexity", () => {
    expect(
      isKaenyApprovalEligible({
        reviewStatus: "approved",
        complexity: "low",
        planReviewerNotes: null,
        hasUiSection: false,
      }),
    ).toBe(false);
  });

  it("is false when not approved", () => {
    expect(
      isKaenyApprovalEligible({
        reviewStatus: "changes-requested",
        complexity: "high",
        planReviewerNotes: null,
        hasUiSection: false,
      }),
    ).toBe(false);
  });

  it("is false when complexity missing", () => {
    expect(
      isKaenyApprovalEligible({
        reviewStatus: "approved",
        complexity: null,
        planReviewerNotes: null,
        hasUiSection: false,
      }),
    ).toBe(false);
  });
});
