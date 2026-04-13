# `@paperclipai/plugin-qmd-memory`

First-party Paperclip memory provider plugin backed by markdown files plus the `qmd` CLI.

## What it does

- registers the `qmd_memory` provider through the plugin runtime
- stores canonical memory records as markdown files under the plugin data directory
- shells out to `qmd` for retrieval and index refresh
- supports capture, query, and forget

## Runtime requirements

- a writable plugin data directory from the Paperclip host
- a `qmd` binary available on `PATH`, or `qmdBinaryPath` set on the memory binding

## Binding config

```json
{
  "searchMode": "query",
  "topK": 5,
  "autoIndexOnWrite": true,
  "qmdBinaryPath": null
}
```

## Verification

```sh
pnpm --filter @paperclipai/plugin-qmd-memory typecheck
pnpm --filter @paperclipai/plugin-qmd-memory test
pnpm --filter @paperclipai/plugin-qmd-memory build
```
