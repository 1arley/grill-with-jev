import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const packageDir = new URL("..", import.meta.url).pathname;
const cli = join(packageDir, "node_modules", "tsx", "dist", "cli.mjs");
const script = join(packageDir, "scripts", "ask-jev.ts");
const baseEnv = (home: string, extra: NodeJS.ProcessEnv = {}) => ({ PATH: process.env.PATH, HOME: home, ...extra });
function run(cwd: string, home: string, request: unknown, extra: NodeJS.ProcessEnv = {}, mock = true) {
  return spawnSync(process.execPath, [cli, script, ...(mock ? ["--mock"] : []), "--session", "eval-session"], {
    cwd, env: baseEnv(home, extra), input: JSON.stringify(request), encoding: "utf8", timeout: 15000,
  });
}
const question = (questionId: string, recommendation = `Choose ${questionId}`, risks: string[] = []) => ({ questionId, title: `Decision ${questionId}`, body: "Which option should be used?", recommendation, dependsOn: [] as string[], risks });

test("mock accepts a frontier, stamps provenance, writes an audit record, and preserves round boundaries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-project-"));
  const home = await mkdtemp(join(tmpdir(), "jev-home-"));
  try {
    await writeFile(join(dir, "README.md"), "A small project with two independent choices.");
    const first = run(dir, home, { round: 1, sessionId: "eval-session", questions: [question("Q1"), question("Q2")], contextFiles: ["README.md"] });
    assert.equal(first.status, 0, first.stderr);
    const output = JSON.parse(first.stdout);
    assert.equal(output.status, "ok");
    assert.deepEqual(output.responses.map((x: { questionId: string }) => x.questionId), ["Q1", "Q2"]);
    assert.ok(output.responses.every((x: { provenance: string; decision: string }) => x.provenance === "jev" && x.decision === "accept"));
    assert.ok(output.responses.every((x: { settled: boolean }) => x.settled));
    assert.equal(output.responses[0].answer, "Choose Q1");

    const later = run(dir, home, { round: 2, sessionId: "eval-session", questions: [question("Q3")], transcript: output.responses.map((x: { questionId: string; answer: string; provenance: string; settled: boolean; rationale: string }) => ({ questionId: x.questionId, answer: x.answer, provenance: x.provenance, settled: x.settled, rationale: x.rationale })) });
    assert.equal(JSON.parse(later.stdout).responses[0].questionId, "Q3");
    const audit = await readFile(join(dir, ".grill", "eval-session.jsonl"), "utf8");
    assert.equal(audit.trim().split("\n").length, 2);
    assert.match(audit, /"provenance":"jev"/);
  } finally { await rm(dir, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }); }
});

test("mock escalates security topics, and configured round/token ceilings stop further rounds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-limits-"));
  const home = await mkdtemp(join(tmpdir(), "jev-home-"));
  try {
    const sensitive = run(dir, home, { round: 1, sessionId: "risk-session", questions: [question("Q1", "Use the safe option", ["security"])] });
    const result = JSON.parse(sensitive.stdout);
    assert.equal(result.status, "needs-human");
    assert.match(result.escalations[0].reasons.join(" "), /security/);
    assert.equal(result.responses[0].settled, false);
    const dependent = run(dir, home, { round: 1, questions: [{ ...question("Q2"), dependsOn: ["Q1"] }], transcript: result.responses.map((x: { questionId: string; answer: string; provenance: string; settled: boolean }) => ({ questionId: x.questionId, answer: x.answer, provenance: x.provenance, settled: x.settled })) });
    assert.equal(JSON.parse(dependent.stdout).status, "invalid-request");
    const afterHuman = run(dir, home, { round: 1, questions: [{ ...question("Q2"), dependsOn: ["Q1"] }], transcript: [{ questionId: "Q1", answer: "I accept the safe option", provenance: "user", settled: true }] });
    assert.equal(JSON.parse(afterHuman.stdout).status, "ok");
    const irreversible = run(dir, home, { round: 1, questions: [question("Q9", "Permanently delete production data")] });
    assert.match(JSON.parse(irreversible.stdout).escalations[0].reasons.join(" "), /irreversible/);
    const roundLimit = run(dir, home, { round: 2, questions: [question("Q2")] }, { JEV_MAX_ROUNDS: "1" });
    assert.equal(JSON.parse(roundLimit.stdout).status, "round-limit");

    await mkdir(join(dir, ".grill"), { recursive: true });
    await writeFile(join(dir, ".grill", "limit-session.jsonl"), `${JSON.stringify({ budgetTokens: 20000, round: 1, costUsd: 0})}\n`);
    const tokenLimit = spawnSync(process.execPath, [cli, script, "--mock"], {
      cwd: dir, env: baseEnv(home), input: JSON.stringify({ round: 2, sessionId: "limit-session", questions: [question("Q3")] }), encoding: "utf8", timeout: 15000,
    });
    assert.equal(JSON.parse(tokenLimit.stdout).status, "token-limit");
  } finally { await rm(dir, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }); }
});

test("duplicate question IDs are rejected before an answer round can be created", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-duplicate-"));
  const home = await mkdtemp(join(tmpdir(), "jev-home-"));
  try {
    const result = run(dir, home, { round: 1, questions: [question("Q1"), question("Q1")] });
    assert.equal(JSON.parse(result.stdout).status, "invalid-request");
  } finally { await rm(dir, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }); }
});

test("frontier validation defers dependent questions until their prerequisite is settled", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-frontier-"));
  const home = await mkdtemp(join(tmpdir(), "jev-home-"));
  try {
    const sameRound = run(dir, home, { round: 1, questions: [question("Q1"), { ...question("Q2"), dependsOn: ["Q1"] }] });
    assert.equal(JSON.parse(sameRound.stdout).status, "invalid-request");
    const unresolved = run(dir, home, { round: 1, questions: [{ ...question("Q2"), dependsOn: ["Q1"] }] });
    assert.equal(JSON.parse(unresolved.stdout).status, "invalid-request");
    const staleSettlement = run(dir, home, { round: 1, questions: [{ ...question("Q2"), dependsOn: ["Q1"] }], transcript: [
      { questionId: "Q1", answer: "Earlier human answer", provenance: "user", settled: true },
      { questionId: "Q1", answer: "Later JEV escalation", provenance: "jev", settled: false },
    ] });
    assert.equal(JSON.parse(staleSettlement.stdout).status, "invalid-request");
    const settled = run(dir, home, { round: 1, sessionId: "settled-frontier", questions: [{ ...question("Q2"), dependsOn: ["Q1"] }], transcript: [{ questionId: "Q1", answer: "Choose Q1", provenance: "user", settled: true }] });
    assert.equal(JSON.parse(settled.stdout).status, "ok");
  } finally { await rm(dir, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }); }
});

test("no key gives the ordered three-step fallback without inventing JEV answers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-fallback-"));
  const home = await mkdtemp(join(tmpdir(), "jev-home-"));
  try {
    await mkdir(join(home, ".config", "jev"), { recursive: true });
    await writeFile(join(home, ".config", "jev", "config.json"), JSON.stringify({ dotenvConsent: true, gatewayDotenvConsent: true }));
    const result = run(dir, home, { round: 1, questions: [question("Q1")] }, {}, false);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "no-provider-key");
    assert.deepEqual(output.fallbackOrder, ["configure a key or run setup", "use a JEV sub-agent", "ask the user"]);
    assert.equal("responses" in output, false);
  } finally { await rm(dir, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }); }
});

test("dotenv consent is required before lookup and no dotenv content reaches output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-consent-"));
  const home = await mkdtemp(join(tmpdir(), "jev-home-"));
  const canary = "UNRELATED_CANARY_4f39";
  try {
    await writeFile(join(dir, ".env"), `OPENAI_API_KEY=${canary}`);
    await mkdir(join(home, ".config", "jev"), { recursive: true });
    await writeFile(join(home, ".config", "jev", "config.json"), JSON.stringify({ provider: "openai", model: "test-model" }));
    const result = run(dir, home, { round: 1, questions: [question("Q1")] }, {}, false);
    assert.equal(JSON.parse(result.stdout).status, "consent-required");
    assert.equal(`${result.stdout}${result.stderr}`.includes(canary), false);
  } finally { await rm(dir, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }); }
});

test("TypeSafe and OpenCode keys require an explicit endpoint before any provider call", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-endpoint-required-"));
  const home = await mkdtemp(join(tmpdir(), "jev-home-"));
  const canary = "ENDPOINT_KEY_CANARY_7382";
  try {
    for (const provider of ["typesafe", "opencode-zen"]) {
      const result = run(dir, home, { round: 1, questions: [question("Q1")] }, {
        JEV_PROVIDER: provider, JEV_API_KEY: canary,
      }, false);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).status, "endpoint-required");
      assert.equal(`${result.stdout}${result.stderr}`.includes(canary), false);
    }
  } finally { await rm(dir, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }); }
});
