import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { QMD_MEMORY_PROVIDER_KEY, QMD_PLUGIN_ID } from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: QMD_PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "QMD Memory",
  description: "File-backed markdown memory provider powered by the qmd CLI.",
  author: "Paperclip",
  categories: ["workspace"],
  capabilities: ["memory.providers.register"],
  entrypoints: {
    worker: "./dist/src/worker.js",
  },
  memoryProviders: [
    {
      key: QMD_MEMORY_PROVIDER_KEY,
      displayName: "QMD Memory",
      description: "Stores markdown records on disk and queries them through qmd.",
      capabilities: {
        browse: true,
        correction: false,
        asyncIngestion: false,
        providerManagedExtraction: false,
      },
      configSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          searchMode: {
            type: "string",
            enum: ["query", "search", "vsearch"],
            default: "query",
          },
          topK: {
            type: "integer",
            minimum: 1,
            maximum: 25,
            default: 5,
          },
          autoIndexOnWrite: {
            type: "boolean",
            default: true,
          },
          qmdBinaryPath: {
            type: ["string", "null"],
            default: null,
          },
        },
      },
    },
  ],
};

export default manifest;
