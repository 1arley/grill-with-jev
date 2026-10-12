import assert from "node:assert/strict";
import test from "node:test";
import { retryInvalidRound } from "./validate-round.js";

const valid = { round: 1, answers: [{ questionId: "Q1", decision: "accept", answer: "Use SQLite", rationale: "Simple.", confidence: 0.9, assumptions: [] }] };

test("retries once with validation feedback and returns a corrected round", async () => {
  let calls = 0;
  const result = await retryInvalidRound(async feedback => {
    calls++;
    if (calls === 1) return { value: { round: 1, answers: [] } };
    assert.match(feedback?.join(" ") ?? "", /answers/);
    return { value: valid };
  }, ["Q1"], { Q1: "Use SQLite" });
  assert.equal(calls, 2);
  assert.deepEqual(result.round, valid);
});

test("escalates after the second invalid response", async () => {
  let calls = 0;
  const result = await retryInvalidRound(async () => { calls++; return { value: { round: 1, answers: [] } }; }, ["Q1"]);
  assert.equal(calls, 2);
  assert.equal(result.round, undefined);
  assert.ok(result.errors.length);
});

test("an accepted answer must repeat the recommendation", async () => {
  let calls = 0;
  const result = await retryInvalidRound(async () => { calls++; return { value: { ...valid, answers: [{ ...valid.answers[0], answer: "A different option" }] } }; }, ["Q1"], { Q1: "Use SQLite" });
  assert.equal(calls, 2);
  assert.match(result.errors.join(" "), /repeat recommendation/);
});

test("a response for a different round is retried and rejected", async () => {
  let calls = 0;
  const result = await retryInvalidRound(async feedback => {
    calls++;
    if (calls === 2) assert.match(feedback?.join(" ") ?? "", /round must equal 1/);
    return { value: { ...valid, round: 2 } };
  }, ["Q1"], {}, 1);
  assert.equal(calls, 2);
  assert.equal(result.round, undefined);
  assert.match(result.errors.join(" "), /round must equal 1/);
});
