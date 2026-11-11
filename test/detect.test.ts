import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { profileProject } from "../src/detect";

const dirs: string[] = [];

async function project(files: Record<string, string>): Promise<string> {
  await mkdir("/tmp/opencode", { recursive: true });
  const root = await mkdtemp(join("/tmp/opencode", "ab-detect-"));
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

describe("profileProject", () => {
  test("detects a TypeScript pnpm project, commands, and existing config", async () => {
    const root = await project({
      "package.json": JSON.stringify({
        name: "web-app",
        packageManager: "pnpm@9.0.0",
        scripts: { dev: "vite", build: "vite build", test: "vitest", lint: "eslint .", typecheck: "tsc --noEmit" },
        dependencies: { react: "^19.0.0" },
        devDependencies: { typescript: "^5.6.0", vitest: "^2.0.0", eslint: "^9.0.0" },
      }),
      "tsconfig.json": "{}",
      "pnpm-lock.yaml": "",
      "pnpm-workspace.yaml": "",
      "opencode.json": "{}",
      "AGENTS.md": "# existing",
      ".opencode/agents/reviewer.md": "---\ndescription: x\n---\n",
    });

    const profile = await profileProject(root);

    expect(profile.name).toBe("web-app");
    expect(profile.languages).toContain("typescript");
    expect(profile.frameworks).toContain("react");
    expect(profile.frameworks).toContain("vitest");
    expect(profile.packageManager).toBe("pnpm");
    expect(profile.commands.test).toBe("pnpm run test");
    expect(profile.commands.typecheck).toBe("pnpm run typecheck");
    expect(profile.monorepo).toBe(true);
    expect(profile.existing.configs).toEqual(["opencode.json"]);
    expect(profile.existing.instructions).toContain("AGENTS.md");
    expect(profile.existing.agents).toContain("reviewer");
  });

  test("detects a Python service without inventing commands", async () => {
    const root = await project({
      "pyproject.toml": '[project]\nname = "ledger"\ndependencies = ["fastapi", "ruff"]\n',
      "uv.lock": "",
      "alembic.ini": "",
    });

    const profile = await profileProject(root);

    expect(profile.name).toBe("ledger");
    expect(profile.languages).toContain("python");
    expect(profile.frameworks).toContain("fastapi");
    expect(profile.packageManager).toBe("uv");
    expect(profile.commands.install).toBe("uv sync");
    expect(profile.commands.lint).toBe("ruff check .");
    expect(profile.commands.test).toBeUndefined();
    expect(profile.signals).toContain("database");
  });

  test("handles an empty directory", async () => {
    const root = await project({});
    const profile = await profileProject(root);
    expect(profile.kinds).toEqual([]);
    expect(profile.commands).toEqual({});
    expect(profile.existing.agents).toEqual([]);
  });
});
