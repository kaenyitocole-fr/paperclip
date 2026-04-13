import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  MemoryBinding,
  MemoryProviderCaptureInput,
  MemoryProviderForgetInput,
  MemoryProviderQueryInput,
  MemoryRecord,
  MemoryScope,
  PluginMemoryProvider,
} from "@paperclipai/plugin-sdk";
import { QMD_PLUGIN_DATA_DIR_ENV, QMD_MEMORY_PROVIDER_KEY } from "../constants.js";
import { createQmdClient, type QmdClient, type QmdMemoryConfig, type QmdSearchMode } from "./qmd.js";
import {
  listRecordFiles,
  readStoredRecord,
  removeStoredRecords,
  resolveBindingDir,
  resolveRecordFileFromHit,
  writeStoredRecord,
} from "./storage.js";

export interface CreateQmdMemoryProviderOptions {
  dataDir?: string;
  qmdClient?: QmdClient;
  now?: () => Date;
  createId?: () => string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}

export function parseQmdMemoryConfig(config: Record<string, unknown> | null | undefined): QmdMemoryConfig {
  const source = config ?? {};
  const searchMode = source.searchMode;
  return {
    searchMode:
      searchMode === "search" || searchMode === "vsearch" || searchMode === "query"
        ? searchMode
        : "query",
    topK: clampInt(source.topK, 5, 1, 25),
    autoIndexOnWrite: source.autoIndexOnWrite === false ? false : true,
    qmdBinaryPath: typeof source.qmdBinaryPath === "string" && source.qmdBinaryPath.trim().length > 0
      ? source.qmdBinaryPath
      : null,
  };
}

function matchesScope(recordScope: MemoryScope, queryScope: MemoryScope) {
  for (const key of ["agentId", "projectId", "issueId", "runId", "subjectId"] as const) {
    const queryValue = queryScope[key];
    if (!queryValue) continue;
    const recordValue = recordScope[key];
    if (recordValue && recordValue !== queryValue) {
      return false;
    }
  }
  return true;
}

function matchesMetadataFilter(
  metadata: Record<string, unknown>,
  filter: Record<string, unknown> | undefined,
) {
  if (!filter) return true;
  return Object.entries(filter).every(([key, value]) => metadata[key] === value);
}

function buildRecord(
  input: MemoryProviderCaptureInput,
  recordId: string,
  now: Date,
): MemoryRecord {
  return {
    id: recordId,
    companyId: input.binding.companyId,
    bindingId: input.binding.id,
    providerKey: input.binding.providerKey,
    scope: input.scope,
    source: input.source,
    title: input.title ?? null,
    content: input.content,
    summary: input.summary ?? null,
    metadata: input.metadata ?? {},
    createdByOperationId: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildFallbackDataDir() {
  return path.resolve(process.cwd(), ".paperclip-plugin-data");
}

export function resolveQmdMemoryDataDir(dataDir?: string) {
  return dataDir ?? process.env[QMD_PLUGIN_DATA_DIR_ENV] ?? buildFallbackDataDir();
}

async function maybeRefreshIndex(
  qmdClient: QmdClient,
  binding: MemoryBinding,
  dataDir: string,
  config: QmdMemoryConfig,
) {
  if (!config.autoIndexOnWrite) return false;
  await qmdClient.refreshIndex({
    bindingDir: resolveBindingDir(dataDir, binding),
    binaryPath: config.qmdBinaryPath,
  });
  return true;
}

export function createQmdMemoryProvider(options: CreateQmdMemoryProviderOptions = {}): PluginMemoryProvider {
  const qmdClient = options.qmdClient ?? createQmdClient();
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const dataDir = resolveQmdMemoryDataDir(options.dataDir);

  return {
    key: QMD_MEMORY_PROVIDER_KEY,
    displayName: "QMD Memory",
    description: "Stores markdown records on disk and queries them through qmd.",
    async query(input: MemoryProviderQueryInput) {
      const config = parseQmdMemoryConfig(input.binding.config);
      const bindingDir = resolveBindingDir(dataDir, input.binding);
      const files = await listRecordFiles(dataDir, input.binding);
      if (files.length === 0) {
        return {
          records: [],
          resultJson: {
            searchMode: config.searchMode,
            qmdHitCount: 0,
          },
        };
      }

      const hits = await qmdClient.query({
        bindingDir,
        binaryPath: config.qmdBinaryPath,
        query: input.query,
        topK: Math.min(input.topK ?? config.topK, 25),
        mode: config.searchMode as QmdSearchMode,
      });

      const records: MemoryRecord[] = [];
      const seenRecordIds = new Set<string>();

      for (const hit of hits) {
        const hitPath = resolveRecordFileFromHit(bindingDir, hit as Record<string, unknown>);
        if (!hitPath) continue;
        let record: MemoryRecord | null = null;
        try {
          record = await readStoredRecord(hitPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        if (!record || record.deletedAt || seenRecordIds.has(record.id)) continue;
        if (!matchesScope(record.scope, input.scope)) continue;
        if (!matchesMetadataFilter(record.metadata, input.metadataFilter)) continue;
        records.push(record);
        seenRecordIds.add(record.id);
        if (records.length >= Math.min(input.topK ?? config.topK, 25)) break;
      }

      return {
        records,
        resultJson: {
          searchMode: config.searchMode,
          qmdHitCount: hits.length,
        },
      };
    },

    async capture(input: MemoryProviderCaptureInput) {
      const config = parseQmdMemoryConfig(input.binding.config);
      const record = buildRecord(input, createId(), now());
      await writeStoredRecord(dataDir, input.binding, {
        record,
        bindingKey: input.binding.key,
      });
      const indexed = await maybeRefreshIndex(qmdClient, input.binding, dataDir, config);
      return {
        records: [record],
        resultJson: {
          indexed,
        },
      };
    },

    async forget(input: MemoryProviderForgetInput) {
      const config = parseQmdMemoryConfig(input.binding.config);
      await removeStoredRecords(dataDir, input.binding, input.recordIds);
      const indexed = await maybeRefreshIndex(qmdClient, input.binding, dataDir, config);
      return {
        forgottenRecordIds: input.recordIds,
        resultJson: {
          indexed,
        },
      };
    },
  };
}
