import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { logger } from "../middleware/logger.js";

const execFileAsync = promisify(execFile);

export interface LocalCheckoutSyncConfig {
  enabled: boolean;
  path: string | undefined;
  remote: string;
  branch: string;
}

export type LocalCheckoutSyncOutcome =
  | "disabled"
  | "no_path"
  | "path_missing"
  | "not_a_git_repo"
  | "fetch_failed"
  | "remote_ref_missing"
  | "local_ref_missing"
  | "already_up_to_date"
  | "dirty_tree"
  | "diverged"
  | "fast_forwarded"
  | "merge_failed";

export interface LocalCheckoutSyncResult {
  outcome: LocalCheckoutSyncOutcome;
  fromSha?: string;
  toSha?: string;
  warning?: string;
}

interface ExecRunner {
  (file: string, args: string[], options?: { cwd?: string }): Promise<{ stdout: string; stderr: string }>;
}

export interface LocalCheckoutSyncDeps {
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

export async function tickLocalCheckoutSync(
  config: LocalCheckoutSyncConfig,
  deps: LocalCheckoutSyncDeps = {},
): Promise<LocalCheckoutSyncResult> {
  if (!config.enabled) return { outcome: "disabled" };
  if (!config.path) return { outcome: "no_path" };

  const exec = deps.exec ?? defaultExec;
  const pathExists = deps.pathExists ?? defaultPathExists;
  const log = logger.child({ scope: "local-checkout-sync", path: config.path });

  if (!(await pathExists(config.path))) {
    log.warn({ path: config.path }, "local-checkout-sync: configured path does not exist");
    return { outcome: "path_missing" };
  }

  const git = (args: string[]) => exec("git", ["-C", config.path!, ...args]);

  try {
    await git(["rev-parse", "--git-dir"]);
  } catch {
    log.warn({ path: config.path }, "local-checkout-sync: configured path is not a git repository");
    return { outcome: "not_a_git_repo" };
  }

  const remoteRef = `${config.remote}/${config.branch}`;

  try {
    await git(["fetch", config.remote, config.branch]);
  } catch (err) {
    log.warn({ err, remote: config.remote, branch: config.branch }, "local-checkout-sync: git fetch failed");
    return { outcome: "fetch_failed", warning: errorMessage(err) };
  }

  let remoteSha: string;
  try {
    const out = await git(["rev-parse", "--verify", remoteRef]);
    remoteSha = out.stdout.trim();
  } catch {
    log.warn({ remoteRef }, "local-checkout-sync: remote ref not found after fetch");
    return { outcome: "remote_ref_missing" };
  }

  let localSha: string;
  try {
    const out = await git(["rev-parse", "--verify", config.branch]);
    localSha = out.stdout.trim();
  } catch {
    log.warn({ branch: config.branch }, "local-checkout-sync: local branch not found");
    return { outcome: "local_ref_missing" };
  }

  if (localSha === remoteSha) {
    return { outcome: "already_up_to_date", fromSha: localSha, toSha: remoteSha };
  }

  const localIsAncestor = await isAncestor(git, localSha, remoteSha);
  if (!localIsAncestor) {
    log.warn(
      { localSha, remoteSha, branch: config.branch, remote: config.remote },
      "local-checkout-sync: local branch has diverged from remote, skipping",
    );
    return { outcome: "diverged", fromSha: localSha, toSha: remoteSha };
  }

  const currentBranch = (await safeRun(() => git(["rev-parse", "--abbrev-ref", "HEAD"]), "")).trim();
  const onTargetBranch = currentBranch === config.branch;

  if (onTargetBranch) {
    if (await isWorkingTreeDirty(git)) {
      log.warn(
        { branch: config.branch },
        "local-checkout-sync: working tree dirty on target branch, skipping fast-forward",
      );
      return { outcome: "dirty_tree", fromSha: localSha, toSha: remoteSha };
    }
    try {
      await git(["merge", "--ff-only", remoteRef]);
    } catch (err) {
      log.warn({ err }, "local-checkout-sync: merge --ff-only failed");
      return { outcome: "merge_failed", fromSha: localSha, toSha: remoteSha, warning: errorMessage(err) };
    }
  } else {
    try {
      await git(["update-ref", `refs/heads/${config.branch}`, remoteSha, localSha]);
    } catch (err) {
      log.warn({ err }, "local-checkout-sync: update-ref failed");
      return { outcome: "merge_failed", fromSha: localSha, toSha: remoteSha, warning: errorMessage(err) };
    }
  }

  log.info(
    { fromSha: localSha, toSha: remoteSha, branch: config.branch, remote: config.remote },
    "local-checkout-sync: fast-forwarded local checkout",
  );
  return { outcome: "fast_forwarded", fromSha: localSha, toSha: remoteSha };
}

async function isAncestor(
  git: (args: string[]) => Promise<{ stdout: string; stderr: string }>,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  try {
    await git(["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

async function isWorkingTreeDirty(
  git: (args: string[]) => Promise<{ stdout: string; stderr: string }>,
): Promise<boolean> {
  const status = await safeRun(() => git(["status", "--porcelain"]), "");
  return status.trim().length > 0;
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
