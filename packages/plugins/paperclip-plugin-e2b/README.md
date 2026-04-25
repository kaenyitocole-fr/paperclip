# `@paperclipai/plugin-e2b`

Published E2B sandbox provider plugin for Paperclip.

This package lives in the Paperclip monorepo, but it is shaped to publish and install like a standalone npm package. That means operators can install it from the Plugins page by package name, and the host will fetch its transitive dependencies at install time.

## Install

From a Paperclip instance, install:

```text
@paperclipai/plugin-e2b
```

The host plugin installer runs `npm install` into the managed plugin directory, so package dependencies such as `e2b` are pulled in during installation.

## Local development

```bash
pnpm --filter @paperclipai/plugin-e2b build
pnpm --filter @paperclipai/plugin-e2b test
pnpm --filter @paperclipai/plugin-e2b typecheck
```

## Package layout

- `src/manifest.ts` declares the sandbox-provider driver metadata
- `src/plugin.ts` implements the environment lifecycle hooks
- `paperclipPlugin.manifest` and `paperclipPlugin.worker` point the host at the built plugin entrypoints in `dist/`
