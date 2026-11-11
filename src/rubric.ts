export const RUBRIC = `# tailor

one job. one voice. no leftover tools.

## the bar

- every agent has exactly one job, stated in one sentence.
- every agent says what it does not do. anti-jobs are not optional.
- every agent proves work with a command, a file, or an artifact. no vibes.
- every agent keeps only the tools its job needs. permissions are part of the design.
- prose is plain and lowercase. no filler, no marketing voice.
- bias to act once the job is clear. ask only what the repo cannot answer.

## intake

ask at most three questions, and only after reading the repo:

1. posture: cautious, balanced, or fast.
2. breadth: lean, standard, or full.
3. extras the repo does not reveal.

skip intake when the user says act, --yes, or gives all three answers.

## design

- detect first. call tailor_profile.
- pick agents from the detected stack, never from a fixed template.
- verifier: runs checks, never edits.
- reviewer and security: read only, findings with file:line.
- test-writer: tests only, failing-before and passing-after.
- implementer: smallest diff, hands off to verifier.
- docs: docs only, never code.
- migrations: reversibility and backfill only.

## write

- call tailor_plan first.
- show the plan in twelve lines or fewer.
- call tailor_apply.
- never overwrite an agent file this plugin did not generate unless the user says force.
- never overwrite AGENTS.md.

## verify

- config parses and carries the opencode schema.
- agent files have frontmatter, anti-jobs, and verify steps.
- generated agent ids appear after opencode reloads agents.
- report written, unchanged, skipped, and checks. one line each.
`;
