/**
 * Small JSONC reader/writer.
 *
 * OpenCode accepts JSON and JSONC. We only need to read existing files
 * tolerantly and write something valid back. Comments in an existing file are
 * reported as a warning rather than silently pretending they survived.
 */

export function parseJsonc(text: string): unknown {
  const withoutComments = stripComments(text.replace(/^\uFEFF/, ""));
  return JSON.parse(stripTrailingCommas(withoutComments));
}

export function hasComments(text: string): boolean {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "/" && (next === "/" || next === "*")) return true;
  }
  return false;
}

function stripComments(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];

    if (lineComment) {
      if (ch === "\n") {
        lineComment = false;
        out += ch;
      }
      continue;
    }

    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i++;
      } else if (ch === "\n") {
        // keep line numbers roughly intact for JSON.parse errors
        out += ch;
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      lineComment = true;
      i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }

    out += ch;
  }

  return out;
}

function stripTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      if (text[j] === "}" || text[j] === "]") continue;
    }

    out += ch;
  }

  return out;
}

export function stringifyJsonc(value: unknown, header?: string): string {
  const body = JSON.stringify(value, null, 2) + "\n";
  if (!header) return body;
  const commented = header
    .split("\n")
    .map((line) => (line.length > 0 ? `// ${line}` : "//"))
    .join("\n");
  return `${commented}\n${body}`;
}
