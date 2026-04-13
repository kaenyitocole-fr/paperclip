import type {
  MemoryBindingTargetType,
  MemoryExtractionJobStatus,
  MemoryHookKind,
  MemoryOperationStatus,
  MemoryOperationType,
  MemoryProviderKind,
  MemorySourceKind,
  MemoryTriggerKind,
} from "../constants.js";

export interface MemoryProviderCapabilities {
  browse: boolean;
  correction: boolean;
  asyncIngestion: boolean;
  providerManagedExtraction: boolean;
}

export interface MemoryProviderDescriptor {
  key: string;
  displayName: string;
  description: string | null;
  kind: MemoryProviderKind;
  pluginId: string | null;
  capabilities: MemoryProviderCapabilities;
  configSchema: Record<string, unknown> | null;
}

export interface MemoryUsage {
  provider: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  embeddingTokens: number;
  costCents: number;
  latencyMs: number | null;
  details: Record<string, unknown> | null;
}

export interface MemoryScope {
  agentId?: string | null;
  projectId?: string | null;
  issueId?: string | null;
  runId?: string | null;
  subjectId?: string | null;
}

export interface MemorySourceRef {
  kind: MemorySourceKind;
  issueId?: string | null;
  commentId?: string | null;
  documentKey?: string | null;
  runId?: string | null;
  activityId?: string | null;
  externalRef?: string | null;
}

export interface MemoryBinding {
  id: string;
  companyId: string;
  key: string;
  name: string | null;
  providerKey: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryBindingTarget {
  id: string;
  companyId: string;
  bindingId: string;
  targetType: MemoryBindingTargetType;
  targetId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryResolvedBinding {
  companyId: string;
  targetType: MemoryBindingTargetType | null;
  targetId: string | null;
  binding: MemoryBinding | null;
}

export interface MemoryRecordHandle {
  providerKey: string;
  recordId: string;
}

export interface MemoryRecord {
  id: string;
  companyId: string;
  bindingId: string;
  providerKey: string;
  scope: MemoryScope;
  source: MemorySourceRef | null;
  title: string | null;
  content: string;
  summary: string | null;
  metadata: Record<string, unknown>;
  createdByOperationId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryOperation {
  id: string;
  companyId: string;
  bindingId: string;
  providerKey: string;
  operationType: MemoryOperationType;
  triggerKind: MemoryTriggerKind;
  hookKind: MemoryHookKind | null;
  status: MemoryOperationStatus;
  actorType: "agent" | "user" | "system";
  actorId: string;
  agentId: string | null;
  userId: string | null;
  scope: MemoryScope;
  source: MemorySourceRef | null;
  queryText: string | null;
  recordCount: number;
  requestJson: Record<string, unknown> | null;
  resultJson: Record<string, unknown> | null;
  usage: MemoryUsage[];
  error: string | null;
  costEventId: string | null;
  financeEventId: string | null;
  occurredAt: Date;
  createdAt: Date;
}

export interface MemoryExtractionJob {
  id: string;
  companyId: string;
  bindingId: string;
  providerKey: string;
  operationId: string | null;
  status: MemoryExtractionJobStatus;
  providerJobId: string | null;
  source: MemorySourceRef | null;
  resultJson: Record<string, unknown> | null;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryQueryResult {
  operation: MemoryOperation;
  records: MemoryRecord[];
  preamble: string | null;
}

export interface MemoryCaptureResult {
  operation: MemoryOperation;
  records: MemoryRecord[];
}

export interface MemoryForgetResult {
  operation: MemoryOperation;
  forgottenRecordIds: string[];
}

export interface MemoryProviderQueryInput {
  binding: MemoryBinding;
  scope: MemoryScope;
  query: string;
  topK?: number;
  intent?: "agent_preamble" | "answer" | "browse";
  metadataFilter?: Record<string, unknown>;
}

export interface MemoryProviderQueryOutput {
  records: MemoryRecord[];
  preamble?: string | null;
  usage?: MemoryUsage[];
  resultJson?: Record<string, unknown> | null;
}

export interface MemoryProviderCaptureInput {
  binding: MemoryBinding;
  scope: MemoryScope;
  source: MemorySourceRef;
  title?: string | null;
  content: string;
  summary?: string | null;
  metadata?: Record<string, unknown>;
}

export interface MemoryProviderCaptureOutput {
  records: MemoryRecord[];
  usage?: MemoryUsage[];
  resultJson?: Record<string, unknown> | null;
}

export interface MemoryProviderForgetInput {
  binding: MemoryBinding;
  scope: MemoryScope;
  recordIds: string[];
}

export interface MemoryProviderForgetOutput {
  forgottenRecordIds: string[];
  usage?: MemoryUsage[];
  resultJson?: Record<string, unknown> | null;
}
