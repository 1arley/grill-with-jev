import assert from "node:assert/strict";
import test from "node:test";
import { redact } from "./redact.js";

test("redacts exact canaries recursively from stdout, stderr, transcript, and JSONL-shaped data", () => {
  const canary = "provider-canary-secret-93xq";
  const safe = redact({ stdout: canary, stderr: `error ${canary}`, transcript: [{ answer: canary }], log: JSON.stringify({ rationale: canary }) }, [canary]);
  assert.equal(JSON.stringify(safe).includes(canary), false);
  assert.equal(JSON.stringify(safe).match(/\[REDACTED\]/g)?.length, 4);
});
