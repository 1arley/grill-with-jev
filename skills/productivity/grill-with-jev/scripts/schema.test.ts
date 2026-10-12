import assert from "node:assert/strict";
import test from "node:test";
import { JevRound, JevRoundJSONSchema, validateCoverage } from "./schema.js";

test("JevRound validates types and supplies omitted assumptions", () => {
  const parsed = JevRound.parse({ round: 1, answers: [{ questionId: "Q1", decision: "accept", answer: "Use SQLite", rationale: "Small and sufficient.", confidence: 0.9 }] });
  assert.deepEqual(parsed.answers[0].assumptions, []);
  assert.equal((JevRoundJSONSchema as { type?: string }).type, "object");
});

test("strict schema and question coverage reject extras, omissions, and duplicates", () => {
  assert.equal(JevRound.safeParse({ round: 1, extra: true, answers: [] }).success, false);
  const answer = JevRound.parse({ round: 1, answers: [{ questionId: "Q1", decision: "accept", answer: "x", rationale: "y", confidence: 1, assumptions: [] }] }).answers[0];
  assert.deepEqual(validateCoverage({ round: 1, answers: [answer, answer] }, ["Q1", "Q2"]), ["duplicate question id: Q1", "missing question id: Q2"]);
  assert.deepEqual(validateCoverage({ round: 1, answers: [{ ...answer, questionId: "Q9" }] }, ["Q1"]), ["missing question id: Q1", "unexpected question id: Q9"]);
});
