import assert from "node:assert/strict";
import test from "node:test";
import { decideOffline, handoffQuestion, inputSchema } from "../scripts/handoff-advisor.js";

const catalog = [
  { name: "grill-with-jev", description: "Maps a decision tree and asks the frontier in rounds." },
  { name: "tdd", description: "Test-driven development.", restriction: "explicit invocation only" },
];

test("input rejects empty step and entries missing description", () => {
  assert.ok(inputSchema.safeParse({ step: "run tests", catalog }).success);
  assert.ok(!inputSchema.safeParse({ step: "", catalog }).success);
  assert.ok(!inputSchema.safeParse({ step: "s", catalog: [{ name: "x" }] }).success);
  assert.ok(!inputSchema.safeParse({ step: "s", catalog: [...catalog, ...catalog] }).success);
});

test("empty catalog is 'none' before any provider call", () => {
  const out = decideOffline({ step: "run tests", catalog: [] });
  assert.equal(out.status, "none");
});

test("offline mock picks the first catalog entry and stays scoped to one skill", () => {
  const out = decideOffline({ step: "run tests", catalog });
  assert.equal(out.status, "next_skill");
  assert.equal(out.capability, "grill-with-jev");
  assert.equal(out.additional_work, "unassessed");
});

test("question wires every candidate as a choice criterion plus 'none'", () => {
  const { state, body } = handoffQuestion({ step: "implement the port", catalog });
  const question = body.questions.H1;
  assert.equal(question.type, "choice");
  assert.deepEqual(Object.keys(question.criteria).sort(), ["grill-with-jev", "none", "tdd"]);
  assert.match(question.criteria.tdd, /\(explicit invocation only\)/);
  assert.match(state, /implement the port/);
});
