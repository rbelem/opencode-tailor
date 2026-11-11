import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { CommandKind, ProjectProfile } from "./types";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "vendor",
]);

const MAX_TEXT = 200_000;

type Json = Record<string, unknown>;

async function listDir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readText(path: string): Promise<string | undefined> {
  try {
    const text = await readFile(path, "utf8");
    return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
  } catch {
    return undefined;
  }
}

async function readJson(path: string): Promise<Json | undefined> {
  const text = await readText(path);
  if (text === undefined) return undefined;
  try {
    const value = JSON.parse(text);
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

function setCommand(
  profile: ProjectProfile,
  kind: CommandKind,
  command: string | undefined,
): void {
  if (!command || profile.commands[kind]) return;
  profile.commands[kind] = command;
}

function hasAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

function runnerFor(packageManager: string | undefined): string {
  switch (packageManager) {
    case "bun":
      return "bunx";
    case "pnpm":
      return "pnpm exec";
    case "yarn":
      return "yarn";
    case "npm":
    default:
      return "npx --no-install";
  }
}

function runPrefix(packageManager: string | undefined): string {
  switch (packageManager) {
    case "bun":
      return "bun run";
    case "pnpm":
      return "pnpm run";
    case "yarn":
      return "yarn";
    case "npm":
    default:
      return "npm run";
  }
}

export async function profileProject(root: string): Promise<ProjectProfile> {
  const entries = await listDir(root);
  const names = new Set(entries.map((entry) => entry.name));

  const profile: ProjectProfile = {
    root,
    name: basename(root),
    kinds: [],
    languages: [],
    frameworks: [],
    commands: {},
    commandHints: [],
    monorepo: false,
    workspaces: [],
    existing: {
      configs: [],
      agents: [],
      instructions: [],
      skills: [],
    },
    signals: [],
    notes: [],
  };

  for (const file of ["opencode.json", "opencode.jsonc"]) {
    if (names.has(file)) profile.existing.configs.push(file);
  }
  for (const file of ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md"]) {
    if (names.has(file)) profile.existing.instructions.push(file);
  }

  await detectNode(root, names, profile);
  await detectPython(root, names, profile);
  await detectGo(root, names, profile);
  await detectRust(root, names, profile);
  await detectOther(root, names, profile);
  await detectExistingAgents(root, profile);
  await detectProjectSignals(root, names, profile);

  return profile;
}

async function detectNode(
  root: string,
  names: Set<string>,
  profile: ProjectProfile,
): Promise<void> {
  const pkg = await readJson(join(root, "package.json"));
  if (!pkg) return;

  addUnique(profile.kinds, "node");
  addUnique(profile.languages, "javascript");

  if (typeof pkg.name === "string" && pkg.name.trim()) {
    profile.name = pkg.name.trim();
  }

  const dependencies = {
    ...(isObject(pkg.dependencies) ? pkg.dependencies : {}),
    ...(isObject(pkg.devDependencies) ? pkg.devDependencies : {}),
    ...(isObject(pkg.peerDependencies) ? pkg.peerDependencies : {}),
  } as Record<string, unknown>;
  const dependencyNames = Object.keys(dependencies);
  const scripts = isObject(pkg.scripts) ? pkg.scripts : {};
  const hasScript = (name: string) => typeof scripts[name] === "string";

  if (
    names.has("tsconfig.json") ||
    dependencyNames.includes("typescript") ||
    [...names].some((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
  ) {
    addUnique(profile.languages, "typescript");
  }

  const frameworkMap: Array<[string, string]> = [
    ["next", "next"],
    ["nuxt", "nuxt"],
    ["react", "react"],
    ["react-dom", "react"],
    ["vue", "vue"],
    ["svelte", "svelte"],
    ["@sveltejs/kit", "sveltekit"],
    ["astro", "astro"],
    ["solid-js", "solid"],
    ["@remix-run/react", "remix"],
    ["express", "express"],
    ["fastify", "fastify"],
    ["hono", "hono"],
    ["koa", "koa"],
    ["@nestjs/core", "nestjs"],
    ["electron", "electron"],
    ["react-native", "react-native"],
    ["expo", "expo"],
    ["tailwindcss", "tailwindcss"],
    ["@prisma/client", "prisma"],
    ["drizzle-orm", "drizzle"],
    ["vitest", "vitest"],
    ["jest", "jest"],
    ["@playwright/test", "playwright"],
    ["cypress", "cypress"],
    ["eslint", "eslint"],
    ["@biomejs/biome", "biome"],
    ["prettier", "prettier"],
  ];
  for (const [dependency, label] of frameworkMap) {
    if (dependencyNames.includes(dependency)) {
      addUnique(profile.frameworks, label);
      if (["prisma", "drizzle"].includes(label)) addUnique(profile.signals, "database");
    }
  }
  if (!profile.packageManager && typeof pkg.packageManager === "string") {
    profile.packageManager = pkg.packageManager.split("@")[0];
  }
  const lockfileManagers: Array<[string, string]> = [
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
  ];
  for (const [lockfile, manager] of lockfileManagers) {
    if (!profile.packageManager && names.has(lockfile)) profile.packageManager = manager;
  }
  profile.packageManager ??= "npm";

  const pm = profile.packageManager;
  const run = runPrefix(pm);
  const exec = runnerFor(pm);

  setCommand(profile, "install", `${pm} install`);
  if (hasScript("dev")) setCommand(profile, "dev", `${run} dev`);
  if (hasScript("build")) setCommand(profile, "build", `${run} build`);
  if (hasScript("test")) setCommand(profile, "test", `${run} test`);
  if (hasScript("test:e2e")) setCommand(profile, "e2e", `${run} test:e2e`);
  else if (hasScript("e2e")) setCommand(profile, "e2e", `${run} e2e`);
  if (hasScript("lint")) setCommand(profile, "lint", `${run} lint`);
  else if (dependencyNames.includes("@biomejs/biome")) profile.commandHints.push("biome configured");
  else if (dependencyNames.includes("eslint")) profile.commandHints.push("eslint configured");
  if (hasScript("typecheck")) setCommand(profile, "typecheck", `${run} typecheck`);
  else if (names.has("tsconfig.json")) setCommand(profile, "typecheck", `${exec} tsc --noEmit`);
  if (hasScript("format")) setCommand(profile, "format", `${run} format`);
  else if (dependencyNames.includes("@biomejs/biome")) setCommand(profile, "format", `${exec} biome format --write .`);
  else if (dependencyNames.includes("prettier")) setCommand(profile, "format", `${exec} prettier --write .`);

  if (isObject(pkg.workspaces)) {
    const packages = pkg.workspaces.packages;
    if (Array.isArray(packages)) {
      profile.monorepo = true;
      profile.workspaces.push(...packages.filter((item): item is string => typeof item === "string"));
    }
  } else if (Array.isArray(pkg.workspaces)) {
    profile.monorepo = true;
    profile.workspaces.push(...pkg.workspaces.filter((item): item is string => typeof item === "string"));
  }
  if (names.has("pnpm-workspace.yaml") || names.has("turbo.json") || names.has("nx.json") || names.has("lerna.json")) {
    profile.monorepo = true;
  }
}

async function detectPython(
  root: string,
  names: Set<string>,
  profile: ProjectProfile,
): Promise<void> {
  const pyproject = names.has("pyproject.toml") ? await readText(join(root, "pyproject.toml")) : undefined;
  const requirements = names.has("requirements.txt") ? await readText(join(root, "requirements.txt")) : undefined;
  const isPython =
    Boolean(pyproject) ||
    Boolean(requirements) ||
    names.has("setup.py") ||
    names.has("Pipfile") ||
    names.has("poetry.lock") ||
    names.has("uv.lock") ||
    [...names].some((name) => name.endsWith(".py"));
  if (!isPython) return;

  addUnique(profile.kinds, "python");
  addUnique(profile.languages, "python");

  const text = `${pyproject ?? ""}\n${requirements ?? ""}`.toLowerCase();
  const nameMatch = pyproject?.match(/^\s*name\s*=\s*"([^"]+)"/m);
  if (nameMatch?.[1]) profile.name = nameMatch[1];

  const frameworkMap: Array<[string, string]> = [
    ["fastapi", "fastapi"],
    ["django", "django"],
    ["flask", "flask"],
    ["sqlalchemy", "sqlalchemy"],
    ["pydantic", "pydantic"],
    ["pytest", "pytest"],
    ["ruff", "ruff"],
    ["mypy", "mypy"],
    ["black", "black"],
  ];
  for (const [needle, label] of frameworkMap) {
    if (hasAny(text, [needle])) {
      addUnique(profile.frameworks, label);
      if (label === "sqlalchemy") addUnique(profile.signals, "database");
    }
  }

  if (names.has("uv.lock")) profile.packageManager ??= "uv";
  else if (names.has("poetry.lock")) profile.packageManager ??= "poetry";
  else if (names.has("Pipfile")) profile.packageManager ??= "pipenv";
  else if (names.has("pyproject.toml")) profile.packageManager ??= "pip";

  if (profile.packageManager === "uv") setCommand(profile, "install", "uv sync");
  else if (profile.packageManager === "poetry") setCommand(profile, "install", "poetry install");
  else if (profile.packageManager === "pipenv") setCommand(profile, "install", "pipenv install");
  else if (requirements) setCommand(profile, "install", "pip install -r requirements.txt");

  if (hasAny(text, ["pytest"]) || names.has("tests")) setCommand(profile, "test", "pytest");
  if (hasAny(text, ["ruff"])) {
    setCommand(profile, "lint", "ruff check .");
    setCommand(profile, "format", "ruff format .");
  }
  if (hasAny(text, ["mypy"])) setCommand(profile, "typecheck", "mypy .");
  if (names.has("alembic.ini")) {
    addUnique(profile.signals, "database");
    addUnique(profile.frameworks, "alembic");
  }
}

async function detectGo(
  root: string,
  names: Set<string>,
  profile: ProjectProfile,
): Promise<void> {
  if (!names.has("go.mod")) return;
  const goMod = await readText(join(root, "go.mod"));
  addUnique(profile.kinds, "go");
  addUnique(profile.languages, "go");
  const moduleName = goMod?.match(/^module\s+(\S+)/m)?.[1];
  if (moduleName) profile.name = moduleName.split("/").pop() ?? profile.name;
  profile.packageManager ??= "go";
  setCommand(profile, "build", "go build ./...");
  setCommand(profile, "test", "go test ./...");
  setCommand(profile, "format", "gofmt -w .");
  if (names.has(".golangci.yml") || names.has(".golangci.yaml")) setCommand(profile, "lint", "golangci-lint run");
}

async function detectRust(
  root: string,
  names: Set<string>,
  profile: ProjectProfile,
): Promise<void> {
  if (!names.has("Cargo.toml")) return;
  const cargo = await readText(join(root, "Cargo.toml"));
  addUnique(profile.kinds, "rust");
  addUnique(profile.languages, "rust");
  const packageName = cargo?.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
  if (packageName) profile.name = packageName;
  profile.packageManager ??= "cargo";
  setCommand(profile, "build", "cargo build");
  setCommand(profile, "test", "cargo test");
  setCommand(profile, "lint", "cargo clippy --all-targets");
  setCommand(profile, "format", "cargo fmt");
}

async function detectOther(
  root: string,
  names: Set<string>,
  profile: ProjectProfile,
): Promise<void> {
  if (names.has("Gemfile")) {
    addUnique(profile.kinds, "ruby");
    addUnique(profile.languages, "ruby");
    profile.packageManager ??= "bundler";
    if (names.has(".rubocop.yml")) setCommand(profile, "lint", "bundle exec rubocop");
    if (names.has("spec")) setCommand(profile, "test", "bundle exec rspec");
  }
  if (names.has("composer.json")) {
    addUnique(profile.kinds, "php");
    addUnique(profile.languages, "php");
    profile.packageManager ??= "composer";
  }
  if (names.has("mix.exs")) {
    addUnique(profile.kinds, "elixir");
    addUnique(profile.languages, "elixir");
    profile.packageManager ??= "mix";
    setCommand(profile, "test", "mix test");
  }
  if (names.has("pom.xml")) {
    addUnique(profile.kinds, "java");
    addUnique(profile.languages, "java");
    profile.packageManager ??= "maven";
    setCommand(profile, "test", "mvn test");
  } else if (names.has("build.gradle") || names.has("build.gradle.kts")) {
    addUnique(profile.kinds, "jvm");
    addUnique(profile.languages, "kotlin");
    profile.packageManager ??= "gradle";
    setCommand(profile, "test", "./gradlew test");
  }
  if ([...names].some((name) => name.endsWith(".csproj") || name.endsWith(".sln"))) {
    addUnique(profile.kinds, "dotnet");
    addUnique(profile.languages, "csharp");
    profile.packageManager ??= "dotnet";
    setCommand(profile, "test", "dotnet test");
  }
  if (names.has("CMakeLists.txt")) {
    addUnique(profile.kinds, "cmake");
    addUnique(profile.languages, "c");
    profile.packageManager ??= "cmake";
    setCommand(profile, "build", "cmake --build build");
  } else if (names.has("Makefile")) {
    addUnique(profile.kinds, "make");
    setCommand(profile, "build", "make");
  }
  if (names.has("deno.json") || names.has("deno.jsonc")) {
    addUnique(profile.kinds, "deno");
    addUnique(profile.languages, "typescript");
    profile.packageManager ??= "deno";
    setCommand(profile, "test", "deno test");
    setCommand(profile, "lint", "deno lint");
  }
}

async function detectExistingAgents(root: string, profile: ProjectProfile): Promise<void> {
  const agentsDir = join(root, ".opencode", "agents");
  const entries = await listDir(agentsDir);
  for (const entry of entries) {
    if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".mdx"))) {
      profile.existing.agents.push(entry.name.replace(/\.mdx?$/, ""));
    } else if (entry.isDirectory()) {
      const children = await listDir(join(agentsDir, entry.name));
      for (const child of children) {
        if (child.isFile() && child.name.endsWith(".md")) {
          profile.existing.agents.push(`${entry.name}/${child.name.replace(/\.md$/, "")}`);
        }
      }
    }
  }
  const skillsDir = join(root, ".opencode", "skills");
  const skillEntries = await listDir(skillsDir);
  for (const entry of skillEntries) {
    if (entry.isDirectory()) profile.existing.skills.push(entry.name);
  }
}

async function detectProjectSignals(
  root: string,
  names: Set<string>,
  profile: ProjectProfile,
): Promise<void> {
  if (names.has("Dockerfile") || names.has("docker-compose.yml") || names.has("compose.yaml")) {
    addUnique(profile.signals, "docker");
  }
  if (names.has(".github")) addUnique(profile.signals, "ci");
  if (names.has(".git")) addUnique(profile.signals, "git");
  if (profile.monorepo) addUnique(profile.signals, "monorepo");
  if (names.has("CONTRIBUTING.md")) addUnique(profile.signals, "contributing-guide");
  if (names.has("README.md")) addUnique(profile.signals, "readme");
  if (names.has("Makefile")) addUnique(profile.signals, "makefile");
  if (names.has("docs")) addUnique(profile.signals, "docs");
}
