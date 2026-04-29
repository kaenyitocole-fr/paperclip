import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { logger } from "../middleware/logger.js";

const execFileAsync = promisify(execFile);

export interface AutoPrInput {
  cwd: string;
  branch: string;
  issueTitle: string;
  issueIdentifier: string | null;
  issueDeepLink: string;
}

export interface AutoPrResult {
  prUrl: string | null;
  reason: AutoPrSkipReason | "created" | "already_open";
  warning?: string;
}

export type AutoPrSkipReason =
  | "no_cwd"
  | "cwd_missing"
  | "not_a_git_repo"
  | "no_branch"
  | "branch_missing"
  | "no_remotes"
  | "no_unpushed_commits"
  | "push_failed"
  | "gh_not_installed"
  | "gh_failed";

const FALLBACK_BASE_BRANCHES = ["master", "main", "develop"];

interface ExecRunner {
  (file: string, args: string[], options?: { cwd?: string }): Promise<{ stdout: string; stderr: string }>;
}

export interface AutoPrDeps {
  exec?: ExecRunner;
  pathExists?: (path: string) => Promise<boolean>;
}

const defaultExec: ExecRunner = (file, args, options) =>
  execFileAsync(file, args, options) as Promise<{ stdout: string; stderr: string }>;

const defaultPathExists = async (target: string) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

export async function runAutoPr(input: AutoPrInput, deps: AutoPrDeps = {}): Promise<AutoPrResult> {
  const exec = deps.exec ?? defaultExec;
  const pathExists = deps.pathExists ?? defaultPathExists;
  const log = logger.child({ scope: "auto-pr", branch: input.branch, issue: input.issueIdentifier });

  if (!input.cwd) return skip("no_cwd", log);
  if (!input.branch) return skip("no_branch", log);
  if (!(await pathExists(input.cwd))) return skip("cwd_missing", log, { cwd: input.cwd });

  const git = (args: string[]) => exec("git", ["-C", input.cwd, ...args]);

  try {
    await git(["rev-parse", "--git-dir"]);
  } catch {
    return skip("not_a_git_repo", log, { cwd: input.cwd });
  }

  try {
    await git(["rev-parse", "--verify", input.branch]);
  } catch {
    return skip("branch_missing", log);
  }

  const remotes = (await safeRun(() => git(["remote"]), "")).split("\n").map((r) => r.trim()).filter(Boolean);
  if (remotes.length === 0) return skip("no_remotes", log);

  const remote = remotes.includes("fork") ? "fork" : (remotes.includes("origin") ? "origin" : remotes[0]!);
  const baseBranch = await detectBaseBranch(git, remote);

  const ahead = await countCommitsAhead(git, remote, input.branch, baseBranch);
  if (ahead === 0) return skip("no_unpushed_commits", log, { remote, baseBranch });

  try {
    await git(["push", "-u", remote, input.branch]);
  } catch (err) {
    log.warn({ err }, "auto-pr: git push failed");
    return { prUrl: null, reason: "push_failed", warning: errorMessage(err) };
  }

  const ghOnPath = await commandExists(exec, "gh");
  if (!ghOnPath) return skip("gh_not_installed", log);

  const existingPr = await findOpenPrUrl(exec, input.cwd, input.branch);
  if (existingPr) {
    log.info({ prUrl: existingPr }, "auto-pr: open PR already exists for branch");
    return { prUrl: existingPr, reason: "already_open" };
  }

  const body = buildPrBody(input.issueDeepLink, input.issueIdentifier);
  try {
    const result = await exec(
      "gh",
      [
        "pr",
        "create",
        "--base",
        baseBranch,
        "--head",
        input.branch,
        "--title",
        input.issueTitle,
        "--body",
        body,
      ],
      { cwd: input.cwd },
    );
    const prUrl = extractPrUrl(result.stdout);
    if (!prUrl) {
      log.warn({ stdout: result.stdout }, "auto-pr: gh pr create returned no URL");
      return { prUrl: null, reason: "gh_failed", warning: "no URL in gh output" };
    }
    log.info({ prUrl }, "auto-pr: created draft PR");
    return { prUrl, reason: "created" };
  } catch (err) {
    log.warn({ err }, "auto-pr: gh pr create failed");
    return { prUrl: null, reason: "gh_failed", warning: errorMessage(err) };
  }
}

function skip(reason: AutoPrSkipReason, log: { info: (obj: unknown, msg?: string) => void }, extra?: Record<string, unknown>): AutoPrResult {
  log.info({ reason, ...extra }, "auto-pr: skipped");
  return { prUrl: null, reason };
}

async function detectBaseBranch(
  git: (args: string[]) => Promise<{ stdout: string; stderr: string }>,
  remote: string,
): Promise<string> {
  const head = await safeRun(() => git(["symbolic-ref", `refs/remotes/${remote}/HEAD`]), "");
  const match = head.trim().match(/refs\/remotes\/[^/]+\/(.+)$/);
  if (match) return match[1]!;
  for (const candidate of FALLBACK_BASE_BRANCHES) {
    try {
      await git(["rev-parse", "--verify", `${remote}/${candidate}`]);
      return candidate;
    } catch {
      // try next
    }
  }
  return "master";
}

async function countCommitsAhead(
  git: (args: string[]) => Promise<{ stdout: string; stderr: string }>,
  remote: string,
  branch: string,
  baseBranch: string,
): Promise<number> {
  const remoteRef = `${remote}/${branch}`;
  try {
    await git(["rev-parse", "--verify", remoteRef]);
    const out = await safeRun(() => git(["rev-list", "--count", `${remoteRef}..${branch}`]), "0");
    return Number.parseInt(out.trim(), 10) || 0;
  } catch {
    const baseRef = `${remote}/${baseBranch}`;
    const out = await safeRun(() => git(["rev-list", "--count", `${baseRef}..${branch}`]), "0");
    return Number.parseInt(out.trim(), 10) || 0;
  }
}

async function commandExists(exec: ExecRunner, name: string): Promise<boolean> {
  try {
    await exec("which", [name]);
    return true;
  } catch {
    return false;
  }
}

async function findOpenPrUrl(exec: ExecRunner, cwd: string, branch: string): Promise<string | null> {
  try {
    const result = await exec(
      "gh",
      ["pr", "list", "--head", branch, "--state", "open", "--json", "url", "--limit", "1"],
      { cwd },
    );
    const parsed = JSON.parse(result.stdout || "[]") as Array<{ url?: string }>;
    return parsed[0]?.url ?? null;
  } catch {
    return null;
  }
}

function extractPrUrl(stdout: string): string | null {
  const match = stdout.match(/https?:\/\/\S+/);
  return match ? match[0] : null;
}

function buildPrBody(issueDeepLink: string, identifier: string | null): string {
  const ref = identifier ? `${identifier}` : "this Paperclip issue";
  return `Auto-opened from ${ref}.\n\nTracking issue: ${issueDeepLink}\n`;
}

async function safeRun(fn: () => Promise<{ stdout: string }>, fallback: string): Promise<string> {
  try {
    const result = await fn();
    return result.stdout;
  } catch {
    return fallback;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
