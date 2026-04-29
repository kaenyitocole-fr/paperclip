import { describe, expect, it, vi } from "vitest";
import { runAutoPr } from "./auto-pr.js";

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

const baseInput = {
  cwd: "/tmp/repo",
  branch: "feat/x",
  issueTitle: "Do the thing",
  issueIdentifier: "FOO-1",
  issueDeepLink: "http://host/issues/FOO-1",
};

describe("runAutoPr", () => {
  it("skips when cwd is missing on disk", async () => {
    const { exec } = makeExec([]);
    const result = await runAutoPr({ ...baseInput, cwd: "" }, { exec, pathExists: async () => false });
    expect(result).toEqual({ prUrl: null, reason: "no_cwd" });
  });

  it("skips when not a git repo", async () => {
    const { exec } = makeExec([
      { match: (c) => c.args.includes("rev-parse") && c.args.includes("--git-dir"), result: new Error("nope") },
    ]);
    const result = await runAutoPr(baseInput, { exec, pathExists: async () => true });
    expect(result.reason).toBe("not_a_git_repo");
  });

  it("skips when branch has no unpushed commits", async () => {
    const { exec } = makeExec([
      { match: (c) => c.args.includes("--git-dir"), result: { stdout: ".git" } },
      { match: (c) => c.args.includes("--verify") && c.args.includes("feat/x"), result: { stdout: "abc" } },
      { match: (c) => c.file === "git" && c.args.at(-1) === "remote", result: { stdout: "origin\nfork\n" } },
      { match: (c) => c.args.includes("symbolic-ref"), result: { stdout: "refs/remotes/fork/master\n" } },
      { match: (c) => c.args.includes("rev-list"), result: { stdout: "0\n" } },
    ]);
    const result = await runAutoPr(baseInput, { exec, pathExists: async () => true });
    expect(result.reason).toBe("no_unpushed_commits");
  });

  it("skips when gh CLI is not installed", async () => {
    const { exec, calls } = makeExec([
      { match: (c) => c.args.includes("--git-dir"), result: { stdout: ".git" } },
      { match: (c) => c.args.includes("--verify") && c.args.includes("feat/x"), result: { stdout: "abc" } },
      { match: (c) => c.file === "git" && c.args.at(-1) === "remote", result: { stdout: "fork\n" } },
      { match: (c) => c.args.includes("symbolic-ref"), result: { stdout: "refs/remotes/fork/master\n" } },
      { match: (c) => c.args.includes("rev-list"), result: { stdout: "2\n" } },
      { match: (c) => c.file === "git" && c.args.includes("push"), result: { stdout: "" } },
      { match: (c) => c.file === "which" && c.args[0] === "gh", result: new Error("not found") },
    ]);
    const result = await runAutoPr(baseInput, { exec, pathExists: async () => true });
    expect(result.reason).toBe("gh_not_installed");
    expect(calls.some((c) => c.file === "git" && c.args.includes("push") && c.args.includes("fork"))).toBe(true);
  });

  it("returns existing PR URL when one is already open", async () => {
    const { exec } = makeExec([
      { match: (c) => c.args.includes("--git-dir"), result: { stdout: ".git" } },
      { match: (c) => c.args.includes("--verify") && c.args.includes("feat/x"), result: { stdout: "abc" } },
      { match: (c) => c.file === "git" && c.args.at(-1) === "remote", result: { stdout: "fork\norigin\n" } },
      { match: (c) => c.args.includes("symbolic-ref"), result: { stdout: "refs/remotes/fork/master\n" } },
      { match: (c) => c.args.includes("rev-list"), result: { stdout: "1\n" } },
      { match: (c) => c.file === "git" && c.args.includes("push"), result: { stdout: "" } },
      { match: (c) => c.file === "which", result: { stdout: "/usr/bin/gh" } },
      {
        match: (c) => c.file === "gh" && c.args[0] === "pr" && c.args[1] === "list",
        result: { stdout: '[{"url":"https://github.com/x/y/pull/42"}]' },
      },
    ]);
    const result = await runAutoPr(baseInput, { exec, pathExists: async () => true });
    expect(result).toEqual({ prUrl: "https://github.com/x/y/pull/42", reason: "already_open" });
  });

  it("creates a draft PR and returns its URL", async () => {
    const { exec, calls } = makeExec([
      { match: (c) => c.args.includes("--git-dir"), result: { stdout: ".git" } },
      { match: (c) => c.args.includes("--verify") && c.args.includes("feat/x"), result: { stdout: "abc" } },
      { match: (c) => c.file === "git" && c.args.at(-1) === "remote", result: { stdout: "origin\n" } },
      { match: (c) => c.args.includes("symbolic-ref"), result: { stdout: "refs/remotes/origin/main\n" } },
      { match: (c) => c.args.includes("rev-list"), result: { stdout: "3\n" } },
      { match: (c) => c.file === "git" && c.args.includes("push"), result: { stdout: "" } },
      { match: (c) => c.file === "which", result: { stdout: "/usr/bin/gh" } },
      { match: (c) => c.file === "gh" && c.args[1] === "list", result: { stdout: "[]" } },
      {
        match: (c) => c.file === "gh" && c.args[1] === "create",
        result: { stdout: "Creating draft pull request\nhttps://github.com/x/y/pull/99\n" },
      },
    ]);
    const result = await runAutoPr(baseInput, { exec, pathExists: async () => true });
    expect(result).toEqual({ prUrl: "https://github.com/x/y/pull/99", reason: "created" });
    const create = calls.find((c) => c.file === "gh" && c.args[1] === "create");
    expect(create?.args).toContain("--draft");
    expect(create?.args).toContain("--base");
    expect(create?.args).toContain("main");
    expect(create?.args).toContain(baseInput.issueTitle);
  });

  it("reports push_failed when git push throws", async () => {
    const { exec } = makeExec([
      { match: (c) => c.args.includes("--git-dir"), result: { stdout: ".git" } },
      { match: (c) => c.args.includes("--verify") && c.args.includes("feat/x"), result: { stdout: "abc" } },
      { match: (c) => c.file === "git" && c.args.at(-1) === "remote", result: { stdout: "fork\n" } },
      { match: (c) => c.args.includes("symbolic-ref"), result: { stdout: "refs/remotes/fork/master\n" } },
      { match: (c) => c.args.includes("rev-list"), result: { stdout: "1\n" } },
      { match: (c) => c.file === "git" && c.args.includes("push"), result: new Error("permission denied") },
    ]);
    const result = await runAutoPr(baseInput, { exec, pathExists: async () => true });
    expect(result.reason).toBe("push_failed");
    expect(result.warning).toContain("permission denied");
  });
});
