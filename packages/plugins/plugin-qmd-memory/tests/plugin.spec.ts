import { describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import { createQmdMemoryPlugin } from "../src/worker.js";

describe("qmd memory plugin worker", () => {
  it("registers the memory provider declared in the manifest", async () => {
    const fakeProvider = {
      key: "qmd_memory",
      displayName: "QMD Memory",
      query: vi.fn().mockResolvedValue({ records: [] }),
      capture: vi.fn().mockResolvedValue({ records: [] }),
      forget: vi.fn().mockResolvedValue({ forgottenRecordIds: [] }),
    };
    const plugin = createQmdMemoryPlugin({
      createProvider: () => fakeProvider,
    });
    const harness = createTestHarness({ manifest });

    await plugin.definition.setup(harness.ctx);

    await harness.invokeMemoryProvider("qmd_memory", "query", {
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

    expect(fakeProvider.query).toHaveBeenCalledOnce();
  });
});
