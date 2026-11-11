import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import plugin from "../src/index";

const dirs: string[] = [];

async function project(files: Record<string, string> = {}): Promise<string> {
  await mkdir("/tmp/opencode", { recursive: true });
  const root = await mkdtemp(join("/tmp/opencode", "ab-plugin-"));
  dirs.push(root);
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("plugin wiring", () => {
  test("registers three namespaced tools, the tailor command, and the rubric skill", async () => {
    const root = await project({
      "package.json": JSON.stringify({ name: "demo", scripts: { test: "vitest" } }),
    });

    const tools: Array<{ name: string; options?: { namespace?: string }; execute: (...args: unknown[]) => Promise<unknown> }> = [];
    const commands: string[] = [];
    const skills: Array<{ id: string }> = [];
    const prompts: string[] = [];
    let namespace: string | undefined;

    const registration = { dispose: async () => {} };
    const fake = {
      location: { directory: root },
      agent: { reload: async () => {}, list: async () => [] },
      session: {
        prompt: async (input: { text: string }) => {
          prompts.push(input.text);
          return {};
        },
      },
      tool: {
        transform: async (cb: (editor: unknown) => void) => {
          cb({
            namespace: (value: { name: string }) => {
              namespace = value.name;
            },
            add: (tool: (typeof tools)[number]) => tools.push(tool),
          });
          return registration;
        },
      },
      command: {
        transform: async (cb: (editor: { add: (command: { name: string }) => void }) => void) => {
          cb({ add: (command) => commands.push(command.name) });
          return registration;
        },
      },
      skill: {
        transform: async (cb: (editor: { add: (skill: { id: string }) => void }) => void) => {
          cb({ add: (skill) => skills.push(skill) });
          return registration;
        },
      },
    };

    const cleanup = await plugin.setup(fake as never);

    expect(namespace).toBe("tailor");
    expect(tools.map((tool) => tool.name).sort()).toEqual(["apply", "plan", "profile"]);
    expect(commands).toEqual(["tailor"]);
    expect(skills).toHaveLength(1);

    const profile = tools.find((tool) => tool.name === "profile")!;
    const result = (await profile.execute({}, undefined)) as { content: string };
    expect(JSON.parse(result.content).name).toBe("demo");

    const plan = tools.find((tool) => tool.name === "plan")!;
    const planResult = (await plan.execute({ breadth: "lean" }, undefined)) as { content: string };
    expect(JSON.parse(planResult.content).agents.map((agent: { name: string }) => agent.name)).toEqual([
      "verifier",
      "reviewer",
    ]);

    const apply = tools.find((tool) => tool.name === "apply")!;
    const applyResult = (await apply.execute({ breadth: "lean", dryRun: true }, undefined)) as { content: string };
    const report = JSON.parse(applyResult.content);
    expect(report.dryRun).toBe(true);
    expect(report.written.length).toBeGreaterThan(0);

    expect(prompts).toHaveLength(0);
    await cleanup?.();
  });

  test("the tailor command seeds intake and honors flags", async () => {
    const root = await project();
    const prompts: string[] = [];
    const registration = { dispose: async () => {} };
    const commandBox: Array<{ execute: (input: unknown) => Promise<void> }> = [];

    const fake = {
      location: { directory: root },
      agent: { reload: async () => {}, list: async () => [] },
      session: {
        prompt: async (input: { text: string }) => {
          prompts.push(input.text);
          return {};
        },
      },
      tool: { transform: async () => registration },
      command: {
        transform: async (cb: (editor: { add: (command: (typeof commandBox)[number]) => void }) => void) => {
          cb({ add: (command) => commandBox.push(command) });
          return registration;
        },
      },
      skill: { transform: async () => registration },
    };

    await plugin.setup(fake as never);
    await commandBox[0]!.execute({
      sessionID: "session",
      prompt: { text: "--lean --cautious --dry-run" },
      delivery: "steer",
    });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("tailor_profile");
    expect(prompts[0]).toContain("breadth=lean");
    expect(prompts[0]).toContain("posture=cautious");
    expect(prompts[0]).toContain("dry run only");
  });
});
