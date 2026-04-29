import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const issueId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const agentId = "33333333-3333-4333-8333-333333333333";
const documentId = "44444444-4444-4444-8444-444444444444";
const approvalId = "55555555-5555-4555-8555-555555555555";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  assertCheckoutOwner: vi.fn(),
}));

const mockDocumentService = vi.hoisted(() => ({
  upsertIssueDocument: vi.fn(),
}));

const mockIssueApprovalService = vi.hoisted(() => ({
  ensurePendingGate: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(async () => true),
  hasPermission: vi.fn(async () => false),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(async (id: string) => ({
    id,
    companyId,
    role: "engineer",
    reportsTo: null,
    permissions: { canCreateAgents: false },
  })),
}));

const mockIssueThreadInteractionService = vi.hoisted(() => ({
  expireRequestConfirmationsSupersededByComment: vi.fn(async () => []),
  expireStaleRequestConfirmationsForIssueDocument: vi.fn(async () => []),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

const mockStorageService = {
  provider: "local_disk" as const,
  putFile: vi.fn(),
  getObject: vi.fn(),
  headObject: vi.fn(),
  deleteObject: vi.fn(),
};

function registerRouteMocks() {
  vi.doMock("@paperclipai/shared/telemetry", () => ({
    trackAgentTaskCompleted: vi.fn(),
    trackErrorHandlerCrash: vi.fn(),
  }));

  vi.doMock("../telemetry.js", () => ({
    getTelemetryClient: vi.fn(() => ({ track: vi.fn() })),
  }));

  vi.doMock("../services/index.js", () => ({
    accessService: () => mockAccessService,
    agentService: () => mockAgentService,
    companyService: () => ({}),
    documentService: () => mockDocumentService,
    executionWorkspaceService: () => ({}),
    feedbackService: () => ({
      listIssueVotesForUser: vi.fn(async () => []),
      saveIssueVote: vi.fn(async () => ({ vote: null, consentEnabledNow: false, sharingEnabled: false })),
    }),
    goalService: () => ({}),
    heartbeatService: () => ({
      wakeup: vi.fn(async () => undefined),
      reportRunActivity: vi.fn(async () => undefined),
      getRun: vi.fn(async () => null),
      getActiveRunForAgent: vi.fn(async () => null),
      cancelRun: vi.fn(async () => null),
    }),
    instanceSettingsService: () => ({
      get: vi.fn(async () => ({
        id: "instance-settings-1",
        general: { censorUsernameInLogs: false, feedbackDataSharingPreference: "prompt" },
      })),
      listCompanyIds: vi.fn(async () => [companyId]),
    }),
    issueApprovalService: () => mockIssueApprovalService,
    issueReferenceService: () => ({
      deleteDocumentSource: async () => undefined,
      diffIssueReferenceSummary: () => ({
        addedReferencedIssues: [],
        removedReferencedIssues: [],
        currentReferencedIssues: [],
      }),
      emptySummary: () => ({ outbound: [], inbound: [] }),
      listIssueReferenceSummary: async () => ({ outbound: [], inbound: [] }),
      syncComment: async () => undefined,
      syncDocument: async () => undefined,
      syncIssue: async () => undefined,
    }),
    issueService: () => mockIssueService,
    issueThreadInteractionService: () => mockIssueThreadInteractionService,
    logActivity: mockLogActivity,
    projectService: () => ({}),
    routineService: () => ({
      syncRunStatusForIssue: vi.fn(async () => undefined),
    }),
    workProductService: () => ({}),
    ISSUE_LIST_DEFAULT_LIMIT: 50,
    ISSUE_LIST_MAX_LIMIT: 200,
    clampIssueListLimit: (n: number) => n,
  }));
}

function makeIssue() {
  return {
    id: issueId,
    companyId,
    status: "in_progress",
    priority: "high",
    projectId: null,
    goalId: null,
    parentId: null,
    assigneeAgentId: agentId,
    assigneeUserId: null,
    createdByUserId: "board-user",
    identifier: "TST-1",
    title: "Test issue",
    executionPolicy: null,
    executionState: null,
    hiddenAt: null,
    checkoutRunId: "run-1",
  };
}

function planDocument() {
  return {
    id: documentId,
    companyId,
    issueId,
    key: "plan",
    title: "Plan",
    format: "markdown",
    body: "# Plan",
    latestRevisionId: "rev-1",
    latestRevisionNumber: 1,
    createdByAgentId: agentId,
    createdByUserId: null,
  };
}

async function createApp() {
  const [{ errorHandler }, { issueRoutes }] = await Promise.all([
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
    vi.importActual<typeof import("../routes/issues.js")>("../routes/issues.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "agent",
      agentId,
      companyId,
      source: "agent_key",
      runId: "run-1",
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, mockStorageService as any));
  app.use(errorHandler);
  return app;
}

describe("plan document upsert auto-creates plan_approval gate", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/issues.js");
    vi.doUnmock("../middleware/index.js");
    vi.doUnmock("@paperclipai/shared/telemetry");
    vi.doUnmock("../telemetry.js");
    registerRouteMocks();
    vi.clearAllMocks();
    mockIssueService.getById.mockResolvedValue(makeIssue());
    mockIssueService.assertCheckoutOwner.mockResolvedValue({ ...makeIssue(), adoptedFromRunId: null });
    mockDocumentService.upsertIssueDocument.mockResolvedValue({
      created: true,
      document: planDocument(),
    });
    mockIssueApprovalService.ensurePendingGate.mockResolvedValue({
      approval: {
        id: approvalId,
        companyId,
        type: "plan_approval",
        status: "pending",
      },
      created: true,
    });
  });

  it("creates a plan_approval when an agent first writes the plan", async () => {
    const app = await createApp();
    const res = await request(app)
      .put(`/api/issues/${issueId}/documents/plan`)
      .send({ title: "Plan", format: "markdown", body: "# Plan" });

    expect(res.status).toBe(201);
    expect(mockIssueApprovalService.ensurePendingGate).toHaveBeenCalledTimes(1);
    const [gateInput] = mockIssueApprovalService.ensurePendingGate.mock.calls[0];
    expect(gateInput).toMatchObject({
      issueId,
      companyId,
      type: "plan_approval",
      requestedByAgentId: agentId,
    });
    expect(gateInput.payload).toMatchObject({
      issueId,
      issueIdentifier: "TST-1",
      documentId,
      planRevisionId: "rev-1",
      planRevisionNumber: 1,
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "approval.created",
        entityType: "approval",
        entityId: approvalId,
      }),
    );
  });

  it("does not log a creation activity when one is already pending", async () => {
    mockIssueApprovalService.ensurePendingGate.mockResolvedValue({
      approval: null,
      created: false,
    });
    const app = await createApp();
    const res = await request(app)
      .put(`/api/issues/${issueId}/documents/plan`)
      .send({ title: "Plan v2", format: "markdown", body: "# Plan v2" });

    expect(res.status).toBe(201);
    expect(mockIssueApprovalService.ensurePendingGate).toHaveBeenCalledTimes(1);
    expect(mockLogActivity).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "approval.created" }),
    );
  });

  it("does not auto-create when a board user upserts the plan", async () => {
    const [{ errorHandler }, { issueRoutes }] = await Promise.all([
      vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
      vi.importActual<typeof import("../routes/issues.js")>("../routes/issues.js"),
    ]);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "board",
        userId: "board-user",
        companyIds: [companyId],
        source: "local_implicit",
        isInstanceAdmin: false,
      };
      next();
    });
    app.use("/api", issueRoutes({} as any, mockStorageService as any));
    app.use(errorHandler);

    const res = await request(app)
      .put(`/api/issues/${issueId}/documents/plan`)
      .send({ title: "Plan", format: "markdown", body: "# Plan" });

    expect(res.status).toBe(201);
    expect(mockIssueApprovalService.ensurePendingGate).not.toHaveBeenCalled();
  });

  it("creates a kaeny_approval when plan body has approved review and medium complexity", async () => {
    const body =
      "# Plan\n\n## complexity\nmedium\n\n## plan review\nStatus: approved\n\nLooks good.";
    const app = await createApp();
    const res = await request(app)
      .put(`/api/issues/${issueId}/documents/plan`)
      .send({ title: "Plan", format: "markdown", body });

    expect(res.status).toBe(201);
    const calls = mockIssueApprovalService.ensurePendingGate.mock.calls;
    const kaenyCall = calls.find(([input]) => input.type === "kaeny_approval");
    expect(kaenyCall).toBeDefined();
    expect(kaenyCall![0].payload).toMatchObject({
      issueId,
      issueIdentifier: "TST-1",
      complexity: "medium",
      planReviewerNotes: "Looks good.",
      hasUiSection: false,
    });
  });

  it("does not create a kaeny_approval for low complexity plans", async () => {
    const body =
      "# Plan\n\n## complexity\nlow\n\n## plan review\nStatus: approved";
    const app = await createApp();
    const res = await request(app)
      .put(`/api/issues/${issueId}/documents/plan`)
      .send({ title: "Plan", format: "markdown", body });

    expect(res.status).toBe(201);
    const calls = mockIssueApprovalService.ensurePendingGate.mock.calls;
    expect(calls.find(([input]) => input.type === "kaeny_approval")).toBeUndefined();
  });

  it("does not create a kaeny_approval when plan review is not approved", async () => {
    const body =
      "# Plan\n\n## complexity\nhigh\n\n## plan review\nStatus: changes-requested";
    const app = await createApp();
    const res = await request(app)
      .put(`/api/issues/${issueId}/documents/plan`)
      .send({ title: "Plan", format: "markdown", body });

    expect(res.status).toBe(201);
    const calls = mockIssueApprovalService.ensurePendingGate.mock.calls;
    expect(calls.find(([input]) => input.type === "kaeny_approval")).toBeUndefined();
  });

  it("does not auto-create for non-plan document keys", async () => {
    mockDocumentService.upsertIssueDocument.mockResolvedValue({
      created: true,
      document: { ...planDocument(), key: "spec" },
    });
    const app = await createApp();
    const res = await request(app)
      .put(`/api/issues/${issueId}/documents/spec`)
      .send({ title: "Spec", format: "markdown", body: "# Spec" });

    expect(res.status).toBe(201);
    expect(mockIssueApprovalService.ensurePendingGate).not.toHaveBeenCalled();
  });
});
