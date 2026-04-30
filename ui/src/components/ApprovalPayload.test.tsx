// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApprovalPayloadRenderer, approvalLabel } from "./ApprovalPayload";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("approvalLabel", () => {
  it("uses payload titles for generic board approvals", () => {
    expect(
      approvalLabel("request_board_approval", {
        title: "Reply with an ASCII frog",
      }),
    ).toBe("Board Approval: Reply with an ASCII frog");
  });
});

describe("ApprovalPayloadRenderer", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("renders request_board_approval payload fields without falling back to raw JSON", () => {
    const root = createRoot(container);

    act(() => {
      root.render(
        <ApprovalPayloadRenderer
          type="request_board_approval"
          payload={{
            title: "Reply with an ASCII frog",
            summary: "Board asked for approval before posting the frog.",
            recommendedAction: "Approve the frog reply.",
            nextActionOnApproval: "Post the frog comment on the issue.",
            risks: ["The frog might be too powerful."],
            proposedComment: "(o)<",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Reply with an ASCII frog");
    expect(container.textContent).toContain("Board asked for approval before posting the frog.");
    expect(container.textContent).toContain("Approve the frog reply.");
    expect(container.textContent).toContain("Post the frog comment on the issue.");
    expect(container.textContent).toContain("The frog might be too powerful.");
    expect(container.textContent).toContain("(o)<");
    expect(container.textContent).not.toContain("\"recommendedAction\"");

    act(() => {
      root.unmount();
    });
  });

  it("can hide the repeated title when the card header already shows it", () => {
    const root = createRoot(container);

    act(() => {
      root.render(
        <ApprovalPayloadRenderer
          type="request_board_approval"
          hidePrimaryTitle
          payload={{
            title: "Reply with an ASCII frog",
            summary: "Board asked for approval before posting the frog.",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Board asked for approval before posting the frog.");
    expect(container.textContent).not.toContain("TitleReply with an ASCII frog");

    act(() => {
      root.unmount();
    });
  });

  it("renders clarification_request payload with PR header, quote, and interpretations", () => {
    const root = createRoot(container);

    act(() => {
      root.render(
        <ApprovalPayloadRenderer
          type="clarification_request"
          payload={{
            agentName: "pr-watcher",
            prUrl: "https://github.com/paperclipai/paperclip/pull/4710",
            commentUrl:
              "https://github.com/paperclipai/paperclip/pull/4710#discussion_r1234567890",
            quotedComment: "this seems off",
            agentInterpretations: [
              {
                label: "Rename the variable",
                description: "Rename `foo` to `fooCount` for clarity.",
              },
              {
                label: "Add a comment",
                description: "Document the why instead of renaming.",
              },
            ],
            issueId: "11111111-1111-1111-1111-111111111111",
          }}
        />,
      );
    });

    expect(container.textContent).toContain("pr-watcher");
    expect(container.textContent).toContain("PR #4710");
    expect(container.textContent).toContain("this seems off");
    expect(container.textContent).toContain("Rename the variable");
    expect(container.textContent).toContain("Rename `foo` to `fooCount` for clarity.");
    expect(container.textContent).toContain("Add a comment");
    expect(container.textContent).toContain("View on GitHub");

    act(() => {
      root.unmount();
    });
  });

  it("renders kaeny_approval HTML mockup attachment in a sandboxed iframe", () => {
    const root = createRoot(container);

    act(() => {
      root.render(
        <ApprovalPayloadRenderer
          type="kaeny_approval"
          payload={{
            issueIdentifier: "KIPC-15",
            issueTitle: "Render mockup attachments inline",
            complexity: "medium",
            hasUiSection: true,
            mockupAttachmentUrl:
              "http://localhost:8080/api/attachments/abc/index.html",
            mockupAttachmentName: "index.html",
            mockupAttachmentMimeType: "text/html",
          }}
        />,
      );
    });

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe(
      "http://localhost:8080/api/attachments/abc/index.html",
    );
    const sandbox = iframe?.getAttribute("sandbox") ?? "";
    expect(sandbox.split(/\s+/)).toContain("allow-scripts");
    expect(sandbox.split(/\s+/)).toContain("allow-popups");
    expect(sandbox.split(/\s+/)).not.toContain("allow-same-origin");
    expect(container.textContent).toContain("Open in new tab");
    expect(container.textContent).toContain("Loading mockup");

    act(() => {
      root.unmount();
    });
  });

  it("falls back to a download link for non-HTML kaeny_approval attachments", () => {
    const root = createRoot(container);

    act(() => {
      root.render(
        <ApprovalPayloadRenderer
          type="kaeny_approval"
          payload={{
            issueIdentifier: "KIPC-15",
            complexity: "medium",
            hasUiSection: true,
            mockupAttachmentUrl:
              "http://localhost:8080/api/attachments/abc/spec.pdf",
            mockupAttachmentName: "spec.pdf",
            mockupAttachmentMimeType: "application/pdf",
          }}
        />,
      );
    });

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("spec.pdf");
    expect(container.textContent).toContain("Download");
    const link = container.querySelector(
      'a[href="http://localhost:8080/api/attachments/abc/spec.pdf"]',
    );
    expect(link).not.toBeNull();
    expect(link?.getAttribute("target")).toBe("_blank");

    act(() => {
      root.unmount();
    });
  });

  it("renders kaeny_approval without a preview when no attachment is provided", () => {
    const root = createRoot(container);

    act(() => {
      root.render(
        <ApprovalPayloadRenderer
          type="kaeny_approval"
          payload={{
            issueIdentifier: "KIPC-15",
            complexity: "medium",
            hasUiSection: false,
          }}
        />,
      );
    });

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).not.toContain("Mockup");

    act(() => {
      root.unmount();
    });
  });
});
