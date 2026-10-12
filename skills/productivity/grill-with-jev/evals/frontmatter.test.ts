import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("skill frontmatter matches the directory and requires explicit invocation", async () => {
  const text = await readFile(new URL("../SKILL.md", import.meta.url), "utf8");
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(frontmatter, "YAML frontmatter is present");
  assert.match(frontmatter[1], /^name:\s*grill-with-jev$/m);
  assert.match(frontmatter[1], /^description:\s*.+$/m);
  assert.match(frontmatter[1], /^disable-model-invocation:\s*true$/m);
  assert.equal(text.split("\n").length < 70, true);
});
