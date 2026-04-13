import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MemoryBinding, MemoryRecord, MemoryScope, MemorySourceRef } from "@paperclipai/plugin-sdk";
import { buildFrontmatterMarkdown, parseFrontmatterMarkdown } from "./frontmatter.js";

export interface StoredMemoryRecordInput {
  record: MemoryRecord;
  bindingKey: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function parseDate(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeScope(value: unknown): MemoryScope {
  if (!isPlainRecord(value)) return {};
  return {
    agentId: asString(value.agentId),
    projectId: asString(value.projectId),
    issueId: asString(value.issueId),
    runId: asString(value.runId),
    subjectId: asString(value.subjectId),
  };
}

function normalizeSource(value: unknown): MemorySourceRef | null {
  if (!isPlainRecord(value)) return null;
  const kind = asString(value.kind);
  if (!kind) return null;
  return {
    kind: kind as MemorySourceRef["kind"],
    issueId: asString(value.issueId),
    commentId: asString(value.commentId),
    documentKey: asString(value.documentKey),
    runId: asString(value.runId),
    activityId: asString(value.activityId),
    externalRef: asString(value.externalRef),
  };
}

function sanitizePathSegment(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
}

export function resolveBindingDir(dataDir: string, binding: MemoryBinding) {
  return path.join(
    dataDir,
    "companies",
    binding.companyId,
    "bindings",
    sanitizePathSegment(binding.key),
  );
}

export function resolveRecordsDir(dataDir: string, binding: MemoryBinding) {
  return path.join(resolveBindingDir(dataDir, binding), "records");
}

export function resolveRecordPath(dataDir: string, binding: MemoryBinding, recordId: string) {
  return path.join(resolveRecordsDir(dataDir, binding), `${recordId}.md`);
}

export async function ensureBindingDirs(dataDir: string, binding: MemoryBinding) {
  await mkdir(resolveRecordsDir(dataDir, binding), { recursive: true });
}

export async function listRecordFiles(dataDir: string, binding: MemoryBinding) {
  const recordsDir = resolveRecordsDir(dataDir, binding);
  try {
    const entries = await readdir(recordsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(recordsDir, entry.name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function writeStoredRecord(dataDir: string, binding: MemoryBinding, input: StoredMemoryRecordInput) {
  await ensureBindingDirs(dataDir, binding);
  const frontmatter = {
    recordId: input.record.id,
    companyId: input.record.companyId,
    bindingId: input.record.bindingId,
    bindingKey: input.bindingKey,
    providerKey: input.record.providerKey,
    scope: input.record.scope,
    source: input.record.source,
    title: input.record.title,
    summary: input.record.summary,
    metadata: input.record.metadata,
    createdAt: input.record.createdAt.toISOString(),
    updatedAt: input.record.updatedAt.toISOString(),
    deletedAt: input.record.deletedAt?.toISOString() ?? null,
  };
  await writeFile(
    resolveRecordPath(dataDir, binding, input.record.id),
    buildFrontmatterMarkdown(frontmatter, input.record.content),
    "utf8",
  );
}

export async function readStoredRecord(filePath: string): Promise<MemoryRecord | null> {
  const raw = await readFile(filePath, "utf8");
  const parsed = parseFrontmatterMarkdown(raw);
  const frontmatter = parsed.frontmatter;
  const id = asString(frontmatter.recordId);
  const companyId = asString(frontmatter.companyId);
  const bindingId = asString(frontmatter.bindingId);
  const providerKey = asString(frontmatter.providerKey);
  const createdAt = parseDate(frontmatter.createdAt);
  const updatedAt = parseDate(frontmatter.updatedAt);
  if (!id || !companyId || !bindingId || !providerKey || !createdAt || !updatedAt) {
    return null;
  }

  return {
    id,
    companyId,
    bindingId,
    providerKey,
    scope: normalizeScope(frontmatter.scope),
    source: normalizeSource(frontmatter.source),
    title: asString(frontmatter.title),
    content: parsed.body,
    summary: asString(frontmatter.summary),
    metadata: isPlainRecord(frontmatter.metadata) ? frontmatter.metadata : {},
    createdByOperationId: null,
    deletedAt: parseDate(frontmatter.deletedAt),
    createdAt,
    updatedAt,
  };
}

export async function readStoredRecordById(dataDir: string, binding: MemoryBinding, recordId: string) {
  try {
    return await readStoredRecord(resolveRecordPath(dataDir, binding, recordId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function removeStoredRecords(dataDir: string, binding: MemoryBinding, recordIds: string[]) {
  await Promise.all(
    recordIds.map(async (recordId) => {
      try {
        await rm(resolveRecordPath(dataDir, binding, recordId), { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
    }),
  );
}

export function resolveRecordFileFromHit(
  bindingDir: string,
  hit: Record<string, unknown>,
  recordIdFallbackDir = path.join(bindingDir, "records"),
) {
  const directPath = asString(hit.path) ?? asString(hit.file) ?? asString(hit.filePath);
  if (directPath) {
    return path.isAbsolute(directPath) ? directPath : path.join(bindingDir, directPath);
  }

  const metadata = isPlainRecord(hit.metadata) ? hit.metadata : null;
  const nestedPath =
    (metadata && (asString(metadata.path) ?? asString(metadata.file) ?? asString(metadata.filePath)))
    ?? null;
  if (nestedPath) {
    return path.isAbsolute(nestedPath) ? nestedPath : path.join(bindingDir, nestedPath);
  }

  const recordId =
    asString(hit.recordId)
    ?? asString(hit.id)
    ?? (metadata ? asString(metadata.recordId) ?? asString(metadata.id) : null);
  if (!recordId) return null;
  return path.join(recordIdFallbackDir, `${recordId}.md`);
}
