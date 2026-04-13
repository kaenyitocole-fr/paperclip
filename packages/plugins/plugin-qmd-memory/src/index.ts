export { default as manifest } from "./manifest.js";
export { default as plugin, createQmdMemoryPlugin } from "./worker.js";
export { createQmdMemoryProvider, parseQmdMemoryConfig } from "./lib/provider.js";
export type { QmdClient, QmdMemoryConfig, QmdQueryHit, QmdSearchMode } from "./lib/qmd.js";
