import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";

const packageDir = new URL("..", import.meta.url).pathname;
const cli = join(packageDir, "node_modules", "tsx", "dist", "cli.mjs");
const script = join(packageDir, "scripts", "ask-jev.ts");

test("the stored session cost ceiling stops before making another provider request", async () => {
  const project = await mkdtemp(join(tmpdir(), "jev-cost-limit-"));
  const home = await mkdtemp(join(tmpdir(), "jev-home-"));
  try {
    await mkdir(join(home, ".config", "jev"), { recursive: true });
    await writeFile(join(home, ".config", "jev", "config.json"), JSON.stringify({
      provider: "openai", apiKey: "CANARY_UNUSED_1a2b", model: "eval-model", dotenvConsent: true,
      inputUsdPerMillion: 1, outputUsdPerMillion: 1, maxSessionCostUsd: 0.1,
    }));
    await mkdir(join(project, ".grill"), { recursive: true });
    await writeFile(join(project, ".grill", "cost-session.jsonl"), `${JSON.stringify({ budgetTokens: 1, round: 1, costUsd: 0.1 })}\n`);
    const result = spawnSync(process.execPath, [cli, script], {
      cwd: project, env: { PATH: process.env.PATH, HOME: home },
      input: JSON.stringify({ round: 2, sessionId: "cost-session", questions: [{ questionId: "Q1", title: "Choice", body: "Choose an option", recommendation: "Choose A", dependsOn: [], risks: [] }] }),
      encoding: "utf8", timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "cost-limit");
    assert.equal(`${result.stdout}${result.stderr}`.includes("CANARY_UNUSED_1a2b"), false);
  } finally { await rm(project, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }); }
});

test("a schema retry is stopped before it can cross the session token ceiling", async () => {
  let requests = 0;
  const server = createServer((req, res) => {
    if (!req.url?.endsWith("chat/completions")) { res.writeHead(404).end(); return; }
    requests++;
    req.resume();
    req.on("end", () => {
      const content = JSON.stringify({ round: 1, answers: [] });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "budget-eval", object: "chat.completion", created: 1, model: "eval-model", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}/v1`;
  const project = await mkdtemp(join(tmpdir(), "jev-retry-budget-"));
  const home = await mkdtemp(join(tmpdir(), "jev-home-"));
  const request = JSON.stringify({ round: 1, sessionId: "retry-session", questions: [{ questionId: "Q1", title: "Choice", body: "Choose one", recommendation: "Choose A", dependsOn: [], risks: [] }] });
  const env = { PATH: process.env.PATH, HOME: home, JEV_PROVIDER: "ollama", JEV_MODEL: "eval-model", JEV_BASE_URL: endpoint };
  const run = (args: string[], input: string, extraEnv: NodeJS.ProcessEnv = {}) => new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, script, ...args], { cwd: project, env: { ...env, ...extraEnv }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => stdout += chunk); child.stderr.on("data", chunk => stderr += chunk);
    child.on("error", reject); child.on("close", code => resolve({ stdout, stderr, code }));
    child.stdin.end(input);
  });
  try {
    await mkdir(join(home, ".config", "jev"), { recursive: true });
    await writeFile(join(home, ".config", "jev", "config.json"), JSON.stringify({ provider: "ollama", customBaseUrlConfirmed: endpoint }));
    const dryRun = await run(["--dry-run"], request, { JEV_MAX_SESSION_TOKENS: "100000" });
    assert.equal(JSON.parse(dryRun.stdout).status, "dry-run", dryRun.stderr);
    const estimate = JSON.parse(dryRun.stdout).estimatedInputTokens as number;
    const maxTokens = estimate + 1024 + 1;
    const result = await run([], request, { JEV_MAX_SESSION_TOKENS: String(maxTokens) });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "token-limit");
    assert.equal(requests, 1, "the invalid first response cannot trigger an over-budget retry");
    const audit = await readFile(join(project, ".grill", "retry-session.jsonl"), "utf8");
    const records = audit.trim().split("\n").map(line => JSON.parse(line));
    assert.equal(records.filter((record: { event?: string }) => record.event === "reservation").length, 1);
    assert.equal(records.at(-1).status, "token-limit");
  } finally {
    await rm(project, { recursive: true, force: true }); await rm(home, { recursive: true, force: true });
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
