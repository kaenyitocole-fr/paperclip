import { describe, expect, it, vi } from "vitest";
import { createPluginMemoryProviderDispatcher } from "../services/plugin-memory-provider-dispatcher.js";

describe("plugin memory provider dispatcher", () => {
  it("registers plugin providers and dispatches worker RPC calls", async () => {
    const workerManager = {
      call: vi.fn().mockResolvedValue({ records: [] }),
    } as any;
    const dispatcher = createPluginMemoryProviderDispatcher(workerManager);

    dispatcher.registerPluginProviders("plugin-1", "paperclipai.plugin-qmd-memory", {
      id: "paperclipai.plugin-qmd-memory",
      apiVersion: 1,
      version: "0.1.0",
      displayName: "QMD Memory",
      description: "test",
      author: "Paperclip",
      categories: ["workspace"],
      capabilities: ["memory.providers.register"],
      entrypoints: {
        worker: "./dist/worker.js",
      },
      memoryProviders: [
        {
          key: "qmd_memory",
          displayName: "QMD Memory",
          description: "test provider",
          capabilities: {
            browse: true,
          },
        },
      ],
    });

    expect(dispatcher.listProviders()).toHaveLength(1);

    await dispatcher.query("qmd_memory", {
      binding: {
        id: "binding-1",
        companyId: "company-1",
        key: "default",
        name: null,
        providerKey: "qmd_memory",
        config: {},
        enabled: true,
        createdAt: new Date("2026-04-13T14:00:00.000Z"),
        updatedAt: new Date("2026-04-13T14:00:00.000Z"),
      },
      scope: {},
      query: "hello",
    });

    expect(workerManager.call).toHaveBeenCalledWith("plugin-1", "invokeMemoryProvider", {
      providerKey: "qmd_memory",
      action: "query",
      input: expect.objectContaining({
        query: "hello",
      }),
    });
  });

  it("rejects duplicate provider keys across plugins", () => {
    const dispatcher = createPluginMemoryProviderDispatcher({ call: vi.fn() } as any);

    dispatcher.registerPluginProviders("plugin-1", "plugin.one", {
      id: "plugin.one",
      apiVersion: 1,
      version: "0.1.0",
      displayName: "One",
      description: "one",
      author: "Paperclip",
      categories: ["workspace"],
      capabilities: ["memory.providers.register"],
      entrypoints: {
        worker: "./dist/worker.js",
      },
      memoryProviders: [
        {
          key: "qmd_memory",
          displayName: "QMD Memory",
        },
      ],
    });

    expect(() => {
      dispatcher.registerPluginProviders("plugin-2", "plugin.two", {
        id: "plugin.two",
        apiVersion: 1,
        version: "0.1.0",
        displayName: "Two",
        description: "two",
        author: "Paperclip",
        categories: ["workspace"],
        capabilities: ["memory.providers.register"],
        entrypoints: {
          worker: "./dist/worker.js",
        },
        memoryProviders: [
          {
            key: "qmd_memory",
            displayName: "Also QMD Memory",
          },
        ],
      });
    }).toThrow('Memory provider key "qmd_memory" is already registered by plugin "plugin.one"');
  });
});
