import { definePlugin, runWorker, type PluginMemoryProvider } from "@paperclipai/plugin-sdk";
import { QMD_PLUGIN_DATA_DIR_ENV, QMD_MEMORY_PROVIDER_KEY } from "./constants.js";
import { createQmdMemoryProvider, resolveQmdMemoryDataDir } from "./lib/provider.js";

export function createQmdMemoryPlugin(opts?: {
  createProvider?: () => PluginMemoryProvider;
}) {
  return definePlugin({
    async setup(ctx) {
      ctx.memoryProviders.register(
        QMD_MEMORY_PROVIDER_KEY,
        opts?.createProvider?.() ?? createQmdMemoryProvider(),
      );
      ctx.logger.info("Registered QMD memory provider", {
        providerKey: QMD_MEMORY_PROVIDER_KEY,
        dataDir: resolveQmdMemoryDataDir(),
      });
    },

    async onHealth() {
      const configuredDataDir = process.env[QMD_PLUGIN_DATA_DIR_ENV] ?? null;
      return {
        status: "ok",
        message: configuredDataDir
          ? "QMD memory provider is ready"
          : "QMD memory provider is ready with fallback local data dir",
        details: {
          dataDir: resolveQmdMemoryDataDir(),
          usingFallbackDataDir: configuredDataDir === null,
        },
      };
    },
  });
}

const plugin = createQmdMemoryPlugin();

export default plugin;
runWorker(plugin, import.meta.url);
