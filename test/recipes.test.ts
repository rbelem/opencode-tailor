import { describe, expect, test } from "bun:test";
import { posturePermissions, selectAgents } from "../src/recipes";
import type { ProjectProfile } from "../src/types";

function profile(overrides: Partial<ProjectProfile> = {}): ProjectProfile {
  return {
    root: "/tmp/project",
    name: "demo",
    kinds: ["node"],
    languages: ["typescript"],
    frameworks: ["react", "vitest", "eslint"],
    packageManager: "bun",
    commands: {
      install: "bun install",
      build: "bun run build",
      test: "bun run test",
      lint: "bun run lint",
      typecheck: "bun run typecheck",
    },
    commandHints: [],
    monorepo: false,
    workspaces: [],
    existing: { configs: [], agents: [], instructions: [], skills: [] },
    signals: ["database", "docs", "readme"],
    notes: [],
    ...overrides,
  };
}

describe("selectAgents", () => {
  test("lean is verifier plus reviewer", () => {
    const { agents } = selectAgents(profile(), { breadth: "lean" });
    expect(agents.map((agent) => agent.name)).toEqual(["verifier", "reviewer"]);
  });

  test("standard adds implementer and test-writer", () => {
    const { agents } = selectAgents(profile(), { breadth: "standard" });
    expect(agents.map((agent) => agent.name)).toEqual(["verifier", "reviewer", "implementer", "test-writer"]);
  });

  test("full adds security, docs, and migrations when signals exist", () => {
    const { agents } = selectAgents(profile(), { breadth: "full" });
    expect(agents.map((agent) => agent.name)).toContain("security");
    expect(agents.map((agent) => agent.name)).toContain("docs");
    expect(agents.map((agent) => agent.name)).toContain("migrations");
  });

  test("every agent states one job, at least two anti-jobs, and a verify step", () => {
    const { agents } = selectAgents(profile(), { breadth: "full" });
    for (const agent of agents) {
      expect(agent.job.length).toBeLessThanOrEqual(180);
      expect(agent.job).not.toContain("\n");
      expect(agent.doNot.length).toBeGreaterThanOrEqual(2);
      expect(agent.verify.length).toBeGreaterThanOrEqual(1);
      expect(agent.permissions.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("read-only agents deny editing at the tool level", () => {
    const { agents } = selectAgents(profile(), { breadth: "full" });
    for (const name of ["verifier", "reviewer", "security"]) {
      const agent = agents.find((item) => item.name === name)!;
      expect(agent.permissions).toContainEqual({ action: "edit", resource: "*", effect: "deny" });
    }
  });

  test("test-writer can edit tests but not production code", () => {
    const { agents } = selectAgents(profile(), { breadth: "standard" });
    const agent = agents.find((item) => item.name === "test-writer")!;
    expect(agent.permissions[0]).toEqual({ action: "edit", resource: "*", effect: "deny" });
    expect(agent.permissions).toContainEqual({ action: "edit", resource: "**/*.test.*", effect: "allow" });
  });

  test("unknown explicit agents are skipped with a warning", () => {
    const { agents, warnings } = selectAgents(profile(), { agents: ["verifier", "wizard"] });
    expect(agents.map((agent) => agent.name)).toEqual(["verifier"]);
    expect(warnings.join(" ")).toContain("unknown agent");
  });
});

describe("posturePermissions", () => {
  test("cautious adds asks, fast keeps only hard denies", () => {
    const cautious = posturePermissions("cautious");
    expect(cautious.some((rule) => rule.action === "shell" && rule.resource === "git commit *" && rule.effect === "ask")).toBe(true);

    const fast = posturePermissions("fast");
    expect(fast.every((rule) => rule.effect === "deny")).toBe(true);
    expect(fast).toContainEqual({ action: "shell", resource: "sudo *", effect: "deny" });
  });
});
