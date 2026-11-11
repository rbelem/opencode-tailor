import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseJsonc } from "./jsonc";
import type { ApplyReport, CheckResult, Plan } from "./types";

async function readFileOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

export async function applyPlan(plan: Plan, options: { dryRun?: boolean } = {}): Promise<ApplyReport> {
  const dryRun = options.dryRun === true;
  const written: string[] = [];
  const unchanged: string[] = [];

  for (const file of plan.files) {
    const absolute = join(plan.root, file.path);
    const existing = await readFileOrUndefined(absolute);
    if (existing === file.content) {
      unchanged.push(file.path);
      continue;
    }
    if (!dryRun) {
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, file.content, "utf8");
    }
    written.push(file.path);
  }

  const checks: CheckResult[] = [];
  if (dryRun) {
    checks.push({
      name: "dry-run",
      ok: true,
      detail: `${plan.files.length} file(s) would be written`,
    });
  } else {
    checks.push(await checkConfig(plan));
    checks.push(await checkAgents(plan));
    checks.push(await checkInstructions(plan));
  }

  return {
    root: plan.root,
    dryRun,
    written,
    unchanged,
    skipped: plan.skipped,
    checks,
    warnings: plan.warnings,
  };
}

async function checkConfig(plan: Plan): Promise<CheckResult> {
  const planned = plan.files.find((file) => file.kind === "config");
  const path = planned?.path ?? plan.profile.existing.configs[0] ?? "opencode.jsonc";
  const absolute = join(plan.root, path);
  const raw = await readFileOrUndefined(absolute);
  if (raw === undefined) {
    return { name: "config", ok: false, detail: `${path} was not written` };
  }
  try {
    const parsed = parseJsonc(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { name: "config", ok: false, detail: `${path} is not a JSON object` };
    }
    const config = parsed as Record<string, unknown>;
    if (config["$schema"] !== "https://opencode.ai/config.json") {
      return { name: "config", ok: false, detail: `${path} is missing the opencode $schema` };
    }
    if (Array.isArray(config.instructions)) {
      for (const instruction of config.instructions) {
        if (typeof instruction !== "string") continue;
        const exists = await readFileOrUndefined(join(plan.root, instruction));
        if (exists === undefined) {
          return { name: "config", ok: false, detail: `instruction file missing: ${instruction}` };
        }
      }
    }
    return { name: "config", ok: true, detail: `${path} parses and points at existing instruction files` };
  } catch (error) {
    return { name: "config", ok: false, detail: `${path} does not parse: ${String(error)}` };
  }
}

async function checkAgents(plan: Plan): Promise<CheckResult> {
  const agentFiles = plan.files.filter((file) => file.kind === "agent");
  if (agentFiles.length === 0) {
    return { name: "agents", ok: true, detail: "no agent files planned" };
  }
  const problems: string[] = [];
  for (const file of agentFiles) {
    const raw = await readFileOrUndefined(join(plan.root, file.path));
    if (raw === undefined) {
      problems.push(`${file.path} missing`);
      continue;
    }
    if (!raw.startsWith("---\n")) problems.push(`${file.path} has no frontmatter`);
    if (!raw.includes("## you do not")) problems.push(`${file.path} has no anti-jobs section`);
    if (!raw.includes("## verify")) problems.push(`${file.path} has no verify section`);
    const frontmatterEnd = raw.indexOf("\n---\n", 4);
    if (frontmatterEnd === -1) {
      problems.push(`${file.path} has an unterminated frontmatter`);
      continue;
    }
    const frontmatter = raw.slice(4, frontmatterEnd);
    if (!/^description:/m.test(frontmatter)) problems.push(`${file.path} has no description`);
    if (!/^mode:\s*(primary|subagent|all)$/m.test(frontmatter)) problems.push(`${file.path} has no valid mode`);
    if (!/^permissions:/m.test(frontmatter)) problems.push(`${file.path} has no permissions`);
  }
  if (problems.length > 0) {
    return { name: "agents", ok: false, detail: problems.join("; ") };
  }
  return { name: "agents", ok: true, detail: `${agentFiles.length} agent file(s) have frontmatter, anti-jobs, and verify steps` };
}

async function checkInstructions(plan: Plan): Promise<CheckResult> {
  const planned = plan.files.find((file) => file.kind === "instructions");
  if (!planned) {
    return { name: "instructions", ok: true, detail: "AGENTS.md not written" };
  }
  const raw = await readFileOrUndefined(join(plan.root, planned.path));
  if (raw === undefined) {
    return { name: "instructions", ok: false, detail: `${planned.path} missing` };
  }
  const problems: string[] = [];
  if (!raw.includes("## commands")) problems.push("no commands section");
  if (!raw.includes("## done means")) problems.push("no done-means section");
  if (problems.length > 0) {
    return { name: "instructions", ok: false, detail: `${planned.path}: ${problems.join(", ")}` };
  }
  return { name: "instructions", ok: true, detail: `${planned.path} has commands and a done-means section` };
}
