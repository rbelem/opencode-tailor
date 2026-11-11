import { describe, expect, test } from "bun:test";
import { hasComments, parseJsonc, stringifyJsonc } from "../src/jsonc";

describe("jsonc", () => {
  test("parses line comments, block comments, and trailing commas", () => {
    const text = `{
      // default model
      "model": "anthropic/claude-sonnet-5-5",
      /* keep this out */
      "permissions": [
        { "action": "shell", "resource": "git push *", "effect": "ask" },
      ],
    }`;
    expect(parseJsonc(text)).toEqual({
      model: "anthropic/claude-sonnet-5-5",
      permissions: [{ action: "shell", resource: "git push *", effect: "ask" }],
    });
  });

  test("leaves comment-like text inside strings alone", () => {
    const text = `{ "url": "https://example.com//a", "note": "/* not a comment */" }`;
    expect(parseJsonc(text)).toEqual({ url: "https://example.com//a", note: "/* not a comment */" });
  });

  test("detects comments and writes a commented header", () => {
    expect(hasComments("{ // x\n }")).toBe(true);
    expect(hasComments('{ "x": "//" }')).toBe(false);
    const written = stringifyJsonc({ a: 1 }, "hello");
    expect(written.startsWith("// hello\n{")).toBe(true);
    expect(parseJsonc(written)).toEqual({ a: 1 });
  });
});
