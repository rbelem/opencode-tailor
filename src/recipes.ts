import type {
  AgentSpec,
  Breadth,
  BuilderPreferences,
  CommandKind,
  PermissionRule,
  ProjectProfile,
} from "./types";

export interface Selection {
  agents: AgentSpec[];
  warnings: string[];
}

const deny = (action: string, resource = "*"): PermissionRule => ({ action, resource, effect: "deny" });
const ask = (action: string, resource = "*"): PermissionRule => ({ action, resource, effect: "ask" });
const allow = (action: string, resource = "*"): PermissionRule => ({ action, resource, effect: "allow" });

const noPush = deny("shell", "git push *");
const noSudo = deny("shell", "sudo *");
const noWipe = deny("shell", "rm -rf *");
const noSubagents = deny("subagent");

function commands(profile: ProjectProfile, kinds: CommandKind[]): string[] {
  return kinds
    .map((kind) => profile.commands[kind])
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function stackLabel(profile: ProjectProfile): string {
  const named = [...profile.frameworks.filter((item) => !["eslint", "prettier", "biome", "vitest", "jest", "playwright", "cypress"].includes(item)), ...profile.languages];
  return named.length > 0 ? named.slice(0, 3).join(" + ") : "this project";
}

function testGlobs(profile: ProjectProfile): string[] {
  const globs = ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/tests/**", "**/test/**"];
  if (profile.languages.includes("python")) globs.push("**/test_*.py", "**/*_test.py");
  if (profile.languages.includes("go")) globs.push("**/*_test.go");
  if (profile.languages.includes("rust")) globs.push("tests/**");
  return globs;
}

function verifier(profile: ProjectProfile): AgentSpec {
  const checks = commands(profile, ["typecheck", "lint", "test", "build", "e2e"]);
  return {
    name: "verifier",
    description: `Runs ${stackLabel(profile)} checks and reports exact failures. Read-only.`,
    mode: "subagent",
    job: `run ${stackLabel(profile)} checks and report exact failures.`,
    do: [
      checks.length > 0
        ? `Run the narrowest relevant check first: ${checks.join("; ")}.`
        : "Name the check that should exist, then run it if the command is discoverable.",
      "Report the command, its exit code, and the first actionable error.",
      "If a check cannot run, say exactly what is missing.",
    ],
    doNot: [
      "You do not edit, write, or patch project files.",
      "You do not install or upgrade dependencies.",
      "You do not push, commit, tag, or change CI.",
      "You do not say PASS unless the command you name exited 0.",
    ],
    verify: checks.length > 0 ? checks : ["name the check you could not run and why"],
    permissions: [deny("edit"), noPush, noSudo, noWipe, deny("webfetch"), noSubagents],
    color: "#7dd3fc",
    steps: 24,
  };
}

function reviewer(profile: ProjectProfile): AgentSpec {
  return {
    name: "reviewer",
    description: `Reviews ${stackLabel(profile)} changes for correctness, security, and missing tests. Read-only.`,
    mode: "subagent",
    job: "review changes for correctness, security, data loss, and missing tests.",
    do: [
      "Read the diff and the surrounding code before judging.",
      "List findings in severity order with file:line and a concrete failure mode.",
      "Separate confirmed issues from suspicions.",
    ],
    doNot: [
      "You do not edit files.",
      "You do not run commands or tests.",
      "You do not restate the diff or praise it.",
      "You do not report style preferences as bugs.",
      "You do not invent findings when the change is clean.",
    ],
    verify: ["every finding names a file and line", "if there are no findings, say so in one line"],
    permissions: [deny("edit"), deny("shell"), deny("webfetch"), noSubagents],
    color: "#fca5a5",
    steps: 14,
  };
}

function testWriter(profile: ProjectProfile): AgentSpec {
  const checks = commands(profile, ["test"]);
  const framework = profile.frameworks.find((item) => ["vitest", "jest", "playwright", "cypress", "pytest"].includes(item));
  return {
    name: "test-writer",
    description: `Writes focused ${framework ?? stackLabel(profile)} tests without changing production behavior.`,
    mode: "subagent",
    job: "write the smallest test that proves the behavior or reproduces the bug.",
    do: [
      framework ? `Use the project's existing ${framework} setup.` : "Use the project's existing test setup.",
      "Show the new test failing for a bug before the fix, then passing after.",
      "Keep the test independent of timing and network where possible.",
    ],
    doNot: [
      "You do not change production code to make a test pass.",
      "You do not delete, skip, or weaken an existing assertion.",
      "You do not install a test framework without asking.",
      "You do not snapshot volatile output without normalizing it.",
      "You do not test private helpers when a public behavior test is possible.",
    ],
    verify: checks.length > 0 ? checks : ["show the test command and its result"],
    permissions: [
      deny("edit"),
      ...testGlobs(profile).map((glob) => allow("edit", glob)),
      noPush,
      noSudo,
      noWipe,
      noSubagents,
    ],
    color: "#86efac",
    steps: 24,
  };
}

function implementer(profile: ProjectProfile): AgentSpec {
  const checks = commands(profile, ["typecheck", "lint", "test"]);
  return {
    name: "implementer",
    description: `Implements focused ${stackLabel(profile)} changes without touching infra, migrations, or unrelated code.`,
    mode: "subagent",
    job: `implement focused ${stackLabel(profile)} changes.`,
    do: [
      "Work in the smallest diff that satisfies the request.",
      "Match the existing structure, naming, and style.",
      checks.length > 0 ? `Run the narrowest check while working: ${checks.join("; ")}.` : "Find and run the narrowest available check.",
      "Hand off to the verifier when the change is ready.",
    ],
    doNot: [
      "You do not change CI, deployment, release, or infrastructure files.",
      "You do not add, remove, or upgrade dependencies without asking.",
      "You do not edit migrations or generated code.",
      "You do not rewrite unrelated code.",
      "You do not claim done; the verifier does.",
    ],
    verify: checks.length > 0 ? checks : ["name the check you ran and its result"],
    permissions: [noPush, noSudo, noWipe, noSubagents],
    color: "#fbbf24",
    steps: 32,
  };
}

function docsAgent(profile: ProjectProfile): AgentSpec {
  return {
    name: "docs",
    description: `Updates ${stackLabel(profile)} documentation to match the code without changing behavior.`,
    mode: "subagent",
    job: "update documentation to match the code.",
    do: [
      "Read the code you are documenting before writing.",
      "Point at exact commands, files, and defaults.",
      "Keep prose short and lowercase.",
    ],
    doNot: [
      "You do not change code, tests, or configuration.",
      "You do not invent behavior that is not in the repository.",
      "You do not edit generated docs, changelogs, or vendor files.",
      "You do not add marketing filler.",
    ],
    verify: ["every changed claim points at a file or command in the repo", "no broken relative links"],
    permissions: [deny("edit"), allow("edit", "docs/**"), allow("edit", "**/*.md"), allow("edit", "README*"), deny("shell"), noSubagents],
    color: "#c4b5fd",
    steps: 20,
  };
}

function migrationsAgent(profile: ProjectProfile): AgentSpec {
  const framework = profile.frameworks.find((item) => ["prisma", "drizzle", "alembic", "sqlalchemy"].includes(item)) ?? "the migration framework";
  return {
    name: "migrations",
    description: `Writes or reviews database migrations with a safe, reversible path.`,
    mode: "subagent",
    job: "write or review a safe, reversible database migration.",
    do: [
      `Use ${framework}.`,
      "State the forward change, the rollback, and any backfill.",
      "Name the tables, columns, and indexes affected.",
    ],
    doNot: [
      "You do not run migrations against a real database.",
      "You do not edit application code.",
      "You do not drop or rename a column without a backfill plan.",
      "You do not mix schema changes and data changes in one step when they can be separate.",
    ],
    verify: ["the migration is reversible", "a dry run or lint command is named", "the backfill plan is explicit"],
    permissions: [
      deny("edit"),
      allow("edit", "**/migrations/**"),
      allow("edit", "**/migration/**"),
      allow("edit", "prisma/**"),
      noPush,
      noSudo,
      noWipe,
      deny("shell", "psql *"),
      deny("shell", "mysql *"),
      deny("shell", "mongo *"),
      noSubagents,
    ],
    color: "#fdba74",
    steps: 24,
  };
}

function security(profile: ProjectProfile): AgentSpec {
  return {
    name: "security",
    description: `Finds security issues in ${stackLabel(profile)} changes and ranks them by exploitability. Read-only.`,
    mode: "subagent",
    job: "find security issues in the change and rank them by exploitability.",
    do: [
      "Check secrets, authz, injection, deserialization, path traversal, and unsafe defaults.",
      "Cite file:line and the concrete exploit path.",
      "Separate confirmed issues from suspicions.",
    ],
    doNot: [
      "You do not edit files.",
      "You do not run exploits against remote systems.",
      "You do not report style nits or generic advice.",
      "You do not invent findings when the change is clean.",
    ],
    verify: ["each finding names a file and line", "if there are no findings, say so in one line"],
    permissions: [deny("edit"), deny("shell"), deny("webfetch"), noSubagents],
    color: "#f472b6",
    steps: 16,
  };
}

type Recipe = (profile: ProjectProfile) => AgentSpec;

const CATALOG: Record<string, Recipe> = {
  verifier,
  reviewer,
  "test-writer": testWriter,
  implementer,
  docs: docsAgent,
  migrations: migrationsAgent,
  security,
};

const ALIASES: Record<string, string> = {
  frontend: "implementer",
  backend: "implementer",
  api: "implementer",
  ui: "implementer",
  python: "implementer",
  go: "implementer",
  rust: "implementer",
  tests: "test-writer",
  test: "test-writer",
  migration: "migrations",
  db: "migrations",
  test_writer: "test-writer",
};

function defaultNames(profile: ProjectProfile, breadth: Breadth): string[] {
  const names = ["verifier", "reviewer"];
  if (breadth === "lean") return names;
  names.push("implementer");
  if (profile.commands.test || profile.frameworks.some((item) => ["vitest", "jest", "playwright", "cypress", "pytest"].includes(item))) {
    names.push("test-writer");
  }
  if (breadth === "standard") return names;
  names.push("security");
  if (profile.signals.includes("docs") || profile.signals.includes("readme")) names.push("docs");
  if (profile.signals.includes("database")) names.push("migrations");
  return names;
}

export function selectAgents(profile: ProjectProfile, preferences: BuilderPreferences): Selection {
  const breadth = preferences.breadth ?? "standard";
  const warnings: string[] = [];
  const requested = preferences.agents?.length ? preferences.agents : defaultNames(profile, breadth);
  const seen = new Set<string>();
  const agents: AgentSpec[] = [];

  for (const raw of requested) {
    const name = ALIASES[raw] ?? raw;
    if (seen.has(name)) continue;
    const recipe = CATALOG[name];
    if (!recipe) {
      warnings.push(`unknown agent "${raw}"; skipped`);
      continue;
    }
    if (name === "migrations" && !profile.signals.includes("database")) {
      warnings.push("no database signals detected; migrations agent added anyway because it was requested");
    }
    if (name === "test-writer" && !profile.commands.test) {
      warnings.push("no test command detected; test-writer has no default verify command");
    }
    seen.add(name);
    const spec = recipe(profile);
    agents.push({ ...spec, model: preferences.model ? preferences.model : spec.model });
  }

  if (agents.length === 0) {
    warnings.push("no agents selected; falling back to verifier + reviewer");
    agents.push(verifier(profile), reviewer(profile));
  }

  return { agents, warnings };
}

export function posturePermissions(posture: BuilderPreferences["posture"]): PermissionRule[] {
  const rules: PermissionRule[] = [
    deny("shell", "sudo *"),
    ask("shell", "git push *"),
    ask("read", "**/.env*"),
    ask("edit", "**/.env*"),
  ];
  if (posture === "cautious") {
    rules.push(
      ask("shell", "git commit *"),
      ask("shell", "git reset *"),
      ask("shell", "rm *"),
      ask("edit", "**/*.lock"),
    );
  }
  if (posture === "fast") {
    return rules.filter((rule) => rule.effect === "deny");
  }
  return rules;
}
