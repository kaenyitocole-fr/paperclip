import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  addApprovalCommentSchema,
  createApprovalSchema,
  requestApprovalRevisionSchema,
  resolveApprovalSchema,
  resubmitApprovalSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { logger } from "../middleware/logger.js";
import {
  agentService,
  approvalService,
  heartbeatService,
  issueApprovalService,
  issueService,
  logActivity,
  secretService,
} from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { redactEventPayload } from "../redaction.js";
import type { PluginWorkerManager } from "../services/plugin-worker-manager.js";

function redactApprovalPayload<T extends { payload: Record<string, unknown> }>(approval: T): T {
  return {
    ...approval,
    payload: redactEventPayload(approval.payload) ?? {},
  };
}

export function approvalRoutes(
  db: Db,
  options: { pluginWorkerManager?: PluginWorkerManager } = {},
) {
  const router = Router();
  const svc = approvalService(db);
  const heartbeat = heartbeatService(db, {
    pluginWorkerManager: options.pluginWorkerManager,
  });
  const issueApprovalsSvc = issueApprovalService(db);
  const issuesSvc = issueService(db);
  const agentsSvc = agentService(db);
  const secretsSvc = secretService(db);
  const strictSecretsMode = process.env.PAPERCLIP_SECRETS_STRICT_MODE === "true";

  async function postClarificationDecisionComments(args: {
    approval: { id: string; type: string; payload: Record<string, unknown> };
    outcome: "approved" | "revision_requested" | "rejected";
    decisionNote: string | null | undefined;
    decidedByUserId: string;
    linkedIssueIds: string[];
  }) {
    if (args.approval.type !== "clarification_request") return;
    if (args.linkedIssueIds.length === 0) return;
    const prUrl =
      typeof args.approval.payload?.prUrl === "string" ? args.approval.payload.prUrl : null;
    const verb =
      args.outcome === "approved"
        ? "approved"
        : args.outcome === "revision_requested"
          ? "needs revision"
          : "rejected";
    const header = prUrl
      ? `**Clarification ${verb} for ${prUrl}**`
      : `**Clarification ${verb}**`;
    const note = args.decisionNote?.trim();
    const body = note ? `${header}\n\n${note}` : header;
    for (const issueId of args.linkedIssueIds) {
      try {
        await issuesSvc.addComment(issueId, body, { userId: args.decidedByUserId });
      } catch (err) {
        logger.warn(
          { err, issueId, approvalId: args.approval.id },
          "failed to post clarification decision comment",
        );
      }
    }
  }

  async function findAgentByName(companyId: string, name: string) {
    const allAgents = await agentsSvc.list(companyId);
    const lowered = name.toLowerCase();
    return (
      allAgents.find((agent) => agent.name.toLowerCase() === lowered) ??
      allAgents.find((agent) => agent.name.toLowerCase().startsWith(lowered)) ??
      null
    );
  }

  async function handleKaenyApprovalDecision(args: {
    approval: { id: string; type: string; companyId: string; payload: Record<string, unknown> };
    outcome: "approved" | "revision_requested" | "rejected";
    decisionNote: string | null | undefined;
    decidedByUserId: string;
  }) {
    if (args.approval.type !== "kaeny_approval") return;
    const linkedIssues = await issueApprovalsSvc.listIssuesForApproval(args.approval.id);
    if (linkedIssues.length === 0) return;
    const hasUiSection = args.approval.payload?.hasUiSection === true;
    const targetName =
      args.outcome === "approved"
        ? hasUiSection
          ? "mockup-designer"
          : "implementer"
        : args.outcome === "revision_requested"
          ? "planner"
          : null;
    const targetAgent = targetName ? await findAgentByName(args.approval.companyId, targetName) : null;
    const verb =
      args.outcome === "approved"
        ? "approved"
        : args.outcome === "revision_requested"
          ? "needs revision"
          : "rejected";
    const note = args.decisionNote?.trim();
    const headerLine = `**Plan sign-off ${verb}**`;
    const handoffLine = targetAgent
      ? `Handing off to **${targetAgent.name}**.`
      : targetName
        ? `Wanted to hand off to **${targetName}** but no such agent exists in this company — leaving the assignee unchanged.`
        : null;
    const bodyParts = [headerLine];
    if (handoffLine) bodyParts.push(handoffLine);
    if (note) bodyParts.push(note);
    const commentBody = bodyParts.join("\n\n");

    for (const issue of linkedIssues) {
      try {
        await issuesSvc.addComment(issue.id, commentBody, { userId: args.decidedByUserId });
      } catch (err) {
        logger.warn(
          { err, issueId: issue.id, approvalId: args.approval.id },
          "failed to post kaeny_approval decision comment",
        );
      }
      if (targetAgent && targetAgent.id !== issue.assigneeAgentId) {
        try {
          await issuesSvc.update(issue.id, {
            assigneeAgentId: targetAgent.id,
            assigneeUserId: null,
            actorUserId: args.decidedByUserId,
          });
        } catch (err) {
          logger.warn(
            { err, issueId: issue.id, approvalId: args.approval.id, targetAgentId: targetAgent.id },
            "failed to reassign issue after kaeny_approval decision",
          );
        }
      }
    }
  }

  async function requireApprovalAccess(req: Request, id: string) {
    const approval = await svc.getById(id);
    if (!approval) {
      return null;
    }
    assertCompanyAccess(req, approval.companyId);
    return approval;
  }

  router.get("/companies/:companyId/approvals", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const status = req.query.status as string | undefined;
    const result = await svc.list(companyId, status);
    res.json(result.map((approval) => redactApprovalPayload(approval)));
  });

  router.get("/approvals/:id", async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    res.json(redactApprovalPayload(approval));
  });

  router.post("/companies/:companyId/approvals", validate(createApprovalSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rawIssueIds = req.body.issueIds;
    const issueIds = Array.isArray(rawIssueIds)
      ? rawIssueIds.filter((value: unknown): value is string => typeof value === "string")
      : [];
    const uniqueIssueIds = Array.from(new Set(issueIds));
    const { issueIds: _issueIds, ...approvalInput } = req.body;
    const normalizedPayload =
      approvalInput.type === "hire_agent"
        ? await secretsSvc.normalizeHireApprovalPayloadForPersistence(
            companyId,
            approvalInput.payload,
            { strictMode: strictSecretsMode },
          )
        : approvalInput.payload;

    const actor = getActorInfo(req);
    const approval = await svc.create(companyId, {
      ...approvalInput,
      payload: normalizedPayload,
      requestedByUserId: actor.actorType === "user" ? actor.actorId : null,
      requestedByAgentId:
        approvalInput.requestedByAgentId ?? (actor.actorType === "agent" ? actor.actorId : null),
      status: "pending",
      decisionNote: null,
      decidedByUserId: null,
      decidedAt: null,
      updatedAt: new Date(),
    });

    if (uniqueIssueIds.length > 0) {
      await issueApprovalsSvc.linkManyForApproval(approval.id, uniqueIssueIds, {
        agentId: actor.agentId,
        userId: actor.actorType === "user" ? actor.actorId : null,
      });
    }

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "approval.created",
      entityType: "approval",
      entityId: approval.id,
      details: { type: approval.type, issueIds: uniqueIssueIds },
    });

    res.status(201).json(redactApprovalPayload(approval));
  });

  router.get("/approvals/:id/issues", async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    const issues = await issueApprovalsSvc.listIssuesForApproval(id);
    res.json(issues);
  });

  router.post("/approvals/:id/approve", validate(resolveApprovalSchema), async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    if (!(await requireApprovalAccess(req, id))) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    const decidedByUserId = req.actor.userId ?? "board";
    const { approval, applied } = await svc.approve(id, decidedByUserId, req.body.decisionNote);

    if (applied) {
      const linkedIssues = await issueApprovalsSvc.listIssuesForApproval(approval.id);
      const linkedIssueIds = linkedIssues.map((issue) => issue.id);
      const primaryIssueId = linkedIssueIds[0] ?? null;

      await postClarificationDecisionComments({
        approval,
        outcome: "approved",
        decisionNote: req.body.decisionNote,
        decidedByUserId,
        linkedIssueIds,
      });

      await handleKaenyApprovalDecision({
        approval,
        outcome: "approved",
        decisionNote: req.body.decisionNote,
        decidedByUserId,
      });

      await logActivity(db, {
        companyId: approval.companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "approval.approved",
        entityType: "approval",
        entityId: approval.id,
        details: {
          type: approval.type,
          requestedByAgentId: approval.requestedByAgentId,
          linkedIssueIds,
        },
      });

      if (approval.requestedByAgentId) {
        try {
          const wakeRun = await heartbeat.wakeup(approval.requestedByAgentId, {
            source: "automation",
            triggerDetail: "system",
            reason: "approval_approved",
            payload: {
              approvalId: approval.id,
              approvalStatus: approval.status,
              issueId: primaryIssueId,
              issueIds: linkedIssueIds,
            },
            requestedByActorType: "user",
            requestedByActorId: req.actor.userId ?? "board",
            contextSnapshot: {
              source: "approval.approved",
              approvalId: approval.id,
              approvalStatus: approval.status,
              issueId: primaryIssueId,
              issueIds: linkedIssueIds,
              taskId: primaryIssueId,
              wakeReason: "approval_approved",
            },
          });

          await logActivity(db, {
            companyId: approval.companyId,
            actorType: "user",
            actorId: req.actor.userId ?? "board",
            action: "approval.requester_wakeup_queued",
            entityType: "approval",
            entityId: approval.id,
            details: {
              requesterAgentId: approval.requestedByAgentId,
              wakeRunId: wakeRun?.id ?? null,
              linkedIssueIds,
            },
          });
        } catch (err) {
          logger.warn(
            {
              err,
              approvalId: approval.id,
              requestedByAgentId: approval.requestedByAgentId,
            },
            "failed to queue requester wakeup after approval",
          );
          await logActivity(db, {
            companyId: approval.companyId,
            actorType: "user",
            actorId: req.actor.userId ?? "board",
            action: "approval.requester_wakeup_failed",
            entityType: "approval",
            entityId: approval.id,
            details: {
              requesterAgentId: approval.requestedByAgentId,
              linkedIssueIds,
              error: err instanceof Error ? err.message : String(err),
            },
          });
        }
      }
    }

    res.json(redactApprovalPayload(approval));
  });

  router.post("/approvals/:id/reject", validate(resolveApprovalSchema), async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    if (!(await requireApprovalAccess(req, id))) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    const decidedByUserId = req.actor.userId ?? "board";
    const { approval, applied } = await svc.reject(id, decidedByUserId, req.body.decisionNote);

    if (applied) {
      if (approval.type === "clarification_request") {
        const linkedIssues = await issueApprovalsSvc.listIssuesForApproval(approval.id);
        await postClarificationDecisionComments({
          approval,
          outcome: "rejected",
          decisionNote: req.body.decisionNote,
          decidedByUserId,
          linkedIssueIds: linkedIssues.map((issue) => issue.id),
        });
      }

      await handleKaenyApprovalDecision({
        approval,
        outcome: "rejected",
        decisionNote: req.body.decisionNote,
        decidedByUserId,
      });

      await logActivity(db, {
        companyId: approval.companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "approval.rejected",
        entityType: "approval",
        entityId: approval.id,
        details: { type: approval.type },
      });
    }

    res.json(redactApprovalPayload(approval));
  });

  router.post(
    "/approvals/:id/request-revision",
    validate(requestApprovalRevisionSchema),
    async (req, res) => {
      assertBoard(req);
      const id = req.params.id as string;
      if (!(await requireApprovalAccess(req, id))) {
        res.status(404).json({ error: "Approval not found" });
        return;
      }
      const decidedByUserId = req.actor.userId ?? "board";
      const approval = await svc.requestRevision(id, decidedByUserId, req.body.decisionNote);

      await logActivity(db, {
        companyId: approval.companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "approval.revision_requested",
        entityType: "approval",
        entityId: approval.id,
        details: { type: approval.type },
      });

      await handleKaenyApprovalDecision({
        approval,
        outcome: "revision_requested",
        decisionNote: req.body.decisionNote,
        decidedByUserId,
      });

      if (approval.type === "clarification_request") {
        const linkedIssues = await issueApprovalsSvc.listIssuesForApproval(approval.id);
        const linkedIssueIds = linkedIssues.map((issue) => issue.id);
        const primaryIssueId = linkedIssueIds[0] ?? null;

        await postClarificationDecisionComments({
          approval,
          outcome: "revision_requested",
          decisionNote: req.body.decisionNote,
          decidedByUserId,
          linkedIssueIds,
        });

        if (approval.requestedByAgentId) {
          try {
            await heartbeat.wakeup(approval.requestedByAgentId, {
              source: "automation",
              triggerDetail: "system",
              reason: "approval_revision_requested",
              payload: {
                approvalId: approval.id,
                approvalStatus: approval.status,
                issueId: primaryIssueId,
                issueIds: linkedIssueIds,
              },
              requestedByActorType: "user",
              requestedByActorId: req.actor.userId ?? "board",
              contextSnapshot: {
                source: "approval.revision_requested",
                approvalId: approval.id,
                approvalStatus: approval.status,
                issueId: primaryIssueId,
                issueIds: linkedIssueIds,
                taskId: primaryIssueId,
                wakeReason: "approval_revision_requested",
              },
            });
          } catch (err) {
            logger.warn(
              { err, approvalId: approval.id, requestedByAgentId: approval.requestedByAgentId },
              "failed to queue requester wakeup after clarification revision",
            );
          }
        }
      }

      res.json(redactApprovalPayload(approval));
    },
  );

  router.post("/approvals/:id/resubmit", validate(resubmitApprovalSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);

    if (req.actor.type === "agent" && req.actor.agentId !== existing.requestedByAgentId) {
      res.status(403).json({ error: "Only requesting agent can resubmit this approval" });
      return;
    }

    const normalizedPayload = req.body.payload
      ? existing.type === "hire_agent"
        ? await secretsSvc.normalizeHireApprovalPayloadForPersistence(
            existing.companyId,
            req.body.payload,
            { strictMode: strictSecretsMode },
          )
        : req.body.payload
      : undefined;
    const approval = await svc.resubmit(id, normalizedPayload);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: approval.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "approval.resubmitted",
      entityType: "approval",
      entityId: approval.id,
      details: { type: approval.type },
    });
    res.json(redactApprovalPayload(approval));
  });

  router.get("/approvals/:id/comments", async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    const comments = await svc.listComments(id);
    res.json(comments);
  });

  router.post("/approvals/:id/comments", validate(addApprovalCommentSchema), async (req, res) => {
    const id = req.params.id as string;
    const approval = await svc.getById(id);
    if (!approval) {
      res.status(404).json({ error: "Approval not found" });
      return;
    }
    assertCompanyAccess(req, approval.companyId);
    const actor = getActorInfo(req);
    const comment = await svc.addComment(id, req.body.body, {
      agentId: actor.agentId ?? undefined,
      userId: actor.actorType === "user" ? actor.actorId : undefined,
    });

    await logActivity(db, {
      companyId: approval.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "approval.comment_added",
      entityType: "approval",
      entityId: approval.id,
      details: { commentId: comment.id },
    });

    res.status(201).json(comment);
  });

  return router;
}
