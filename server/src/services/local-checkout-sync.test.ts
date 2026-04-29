import { describe, expect, it } from "vitest";
import { tickLocalCheckoutSync, type LocalCheckoutSyncConfig } from "./local-checkout-sync.js";

import { vi } from "vitest";

vi.mock("../middleware/logger.js", () => {
  const noop = () => {};
  const log = { info: noop, warn: noop, error: noop, debug: noop, child: () => log };
  return { logger: log };
});

type ExecCall = { file: string; args: string[] };

interface ExecScript {
  match: (call: ExecCall) => boolean;
  result: { stdout?: string; stderr?: string } | Error;
}

function makeExec(scripts: ExecScript[]) {
  const calls: ExecCall[] = [];
  const exec = async (file: string, args: string[]) => {
    const call = { file, args };
    calls.push(call);
    for (const script of scripts) {
      if (script.match(call)) {
        if (script.result instanceof Error) throw script.result;
        return { stdout: script.result.stdout ?? "", stderr: script.result.stderr ?? "" };
      }
    }
    return { stdout: "", stderr: "" };
  };
  return { exec, calls };
}

const enabledConfig: LocalCheckoutSyncConfig = {
  enabled: true,
  path: "/tmp/repo",
  remote: "fork",
  branch: "master",
};

describe("tickLocalCheckoutSync", () => {
  it("no-ops when disabled", async () => {
    const { exec, calls } = makeExec([]);
    const result = await tickLocalCheckoutSync(
      { ...enabledConfig, enabled: false },
      { exec, pathExists: async () => true },
    );
    expect(result.outcome).toBe("disabled");
    expect(calls).toHaveLength(0);
  });

  it("no-ops when no path is configured", async () => {
    const { exec, calls } = makeExec([]);
    const result = await tickLocalCheckoutSync(
      { ...enabledConfig, path: undefined },
      { exec, pathExists: async () => true },
    );
    expect(result.outcome).toBe("no_path");
    expect(calls).toHaveLength(0);
  });

  it("warns when configured path does not exist", async () => {
    const { exec } = makeExec([]);
    const result = await tickLocalCheckoutSync(enabledConfig, { exec, pathExists: async () => false });
    expect(result.outcome).toBe("path_missing");
  });

  it("warns when path is not a git repo", async () => {
    const { exec } = makeExec([
      { match: (c) => c.args.includes("rev-parse") && c.args.includes("--git-dir"), result: new Error("nope") },
    ]);
    const result = await tickLocalCheckoutSync(enabledConfig, { exec, pathExists: async () => true });
    expect(result.outcome).toBe("not_a_git_repo");
  });

  it("returns already_up_to_date when local matches remote", async () => {
    const sha = "abc123";
    const { exec, calls } = makeExec([
      { match: (c) => c.args.includes("--git-dir"), result: { stdout: ".git" } },
      { match: (c) => c.args[1] === "fetch" || (c.args.includes("fetch") && c.file === "git"), result: { stdout: "" } },
      { match: (c) => c.args.includes("rev-parse") && c.args.includes("fork/master"), result: { stdout: sha } },
      { match: (c) => c.args.includes("rev-parse") && c.args.includes("master") && !c.args.includes("--abbrev-ref"), result: { stdout: sha } },
    ]);
    const result = await tickLocalCheckoutSync(enabledConfig, { exec, pathExists: async () => true });
    expect(result.outcome).toBe("already_up_to_date");
    expect(result.fromSha).toBe(sha);
    expect(calls.some((c) => c.args.includes("merge"))).toBe(false);
  });

  it("skips and warns when local has diverged from remote", async () => {
    const { exec, calls } = makeExec([
      { match: (c) => c.args.includes("--git-dir"), result: { stdout: ".git" } },
      { match: (c) => c.args.includes("fetch") && c.file === "git", result: { stdout: "" } },
      { match: (c) => c.args.includes("rev-parse") && c.args.includes("fork/master"), result: { stdout: "remote-sha" } },
      { match: (c) => c.args.includes("rev-parse") && c.args.includes("master") && !c.args.includes("--abbrev-ref"), result: { stdout: "local-sha" } },
      { match: (c) => c.args.includes("merge-base") && c.args.includes("--is-ancestor"), result: new Error("not ancestor") },
    ]);
    const result = await tickLocalCheckoutSync(enabledConfig, { exec, pathExists: async () => true });
    expect(result.outcome).toBe("diverged");
    expect(calls.some((c) => c.args.includes("merge") && !c.args.includes("merge-base"))).toBe(false);
  });

  it("skips when target branch is checked out and tree is dirty", async () => {
    const { exec, calls } = makeExec([
      { match: (c) => c.args.includes("--git-dir"), result: { stdout: ".git" } },
      { match: (c) => c.args.includes("fetch") && c.file === "git", result: { stdout: "" } },
      { match: (c) => c.args.includes("rev-parse") && c.args.includes("fork/master"), result: { stdout: "remote-sha" } },
      { match: (c) => c.args.includes("rev-parse") && c.args.includes("master") && !c.args.includes("--abbrev-ref"), result: { stdout: "local-sha" } },
      { match: (c) => c.args.includes("merge-base") && c.args.includes("--is-ancestor"), result: { stdout: "" } },
      { match: (c) => c.args.includes("--abbrev-ref"), result: { stdout: "master\n" } },
      { match: (c) => c.args.includes("status") && c.args.includes("--porcelain"), result: { stdout: " M server/src/foo.ts\n" } },
    ]);
    const result = await tickLocalCheckoutSync(enabledConfig, { exec, pathExists: async () => true });
    expect(result.outcome).toBe("dirty_tree");
    expect(calls.some((c) => c.args.includes("merge") && c.args.includes("--ff-only"))).toBe(false);
  });

  it("fast-forwards via merge --ff-only when target branch is checked out and clean", async () => {
    const { exec, calls } = makeExec([
      { match: (c) => c.args.includes("--git-dir"), result: { stdout: ".git" } },
      { match: (c) => c.args.includes("fetch") && c.file === "git", result: { stdout: "" } },
      { match: (c) => c.args.includes("rev-parse") && c.args.includes("fork/master"), result: { stdout: "remote-sha" } },
      { match: (c) => c.args.includes("rev-parse") && c.args.includes("master") && !c.args.includes("--abbrev-ref"), result: { stdout: "local-sha" } },
      { match: (c) => c.args.includes("merge-base") && c.args.includes("--is-ancestor"), result: { stdout: "" } },
      { match: (c) => c.args.includes("--abbrev-ref"), result: { stdout: "master\n" } },
      { match: (c) => c.args.includes("status") && c.args.includes("--porcelain"), result: { stdout: "" } },
      { match: (c) => c.args.includes("merge") && c.args.includes("--ff-only"), result: { stdout: "" } },
    ]);
    const result = await tickLocalCheckoutSync(enabledConfig, { exec, pathExists: async () => true });
    expect(result.outcome).toBe("fast_forwarded");
    expect(result.fromSha).toBe("local-sha");
    expect(result.toSha).toBe("remote-sha");
    expect(calls.some((c) => c.args.includes("merge") && c.args.includes("--ff-only"))).toBe(true);
  });

  it("fast-forwards via update-ref when target branch is not checked out", async () => {
    const { exec, calls } = makeExec([
      { match: (c) => c.args.includes("--git-dir"), result: { stdout: ".git" } },
      { match: (c) => c.args.includes("fetch") && c.file === "git", result: { stdout: "" } },
      { match: (c) => c.args.includes("rev-parse") && c.args.includes("fork/master"), result: { stdout: "remote-sha" } },
      { match: (c) => c.args.includes("rev-parse") && c.args.includes("master") && !c.args.includes("--abbrev-ref"), result: { stdout: "local-sha" } },
      { match: (c) => c.args.includes("merge-base") && c.args.includes("--is-ancestor"), result: { stdout: "" } },
      { match: (c) => c.args.includes("--abbrev-ref"), result: { stdout: "feat/something\n" } },
      { match: (c) => c.args.includes("update-ref"), result: { stdout: "" } },
    ]);
    const result = await tickLocalCheckoutSync(enabledConfig, { exec, pathExists: async () => true });
    expect(result.outcome).toBe("fast_forwarded");
    expect(calls.some((c) => c.args.includes("update-ref") && c.args.includes("refs/heads/master"))).toBe(true);
    expect(calls.some((c) => c.args.includes("status") && c.args.includes("--porcelain"))).toBe(false);
  });

  it("returns fetch_failed and does not attempt a merge when fetch errors", async () => {
    const { exec, calls } = makeExec([
      { match: (c) => c.args.includes("--git-dir"), result: { stdout: ".git" } },
      { match: (c) => c.args.includes("fetch") && c.file === "git", result: new Error("network down") },
    ]);
    const result = await tickLocalCheckoutSync(enabledConfig, { exec, pathExists: async () => true });
    expect(result.outcome).toBe("fetch_failed");
    expect(result.warning).toMatch(/network down/);
    expect(calls.some((c) => c.args.includes("merge"))).toBe(false);
  });
});
