import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const packageDir = new URL("..", import.meta.url).pathname;
const cli = join(packageDir, "node_modules", "tsx", "dist", "cli.mjs");
const script = join(packageDir, "scripts", "ask-jev.ts");

test("provider output, errors, transcript, and audit log never expose a canary key", async () => {
  const canary = "PRIVATE_CANARY_7xQ9n2K5";
  const receivedBodies: string[] = [];
  const server = createServer((req, res) => {
    if (req.url?.endsWith("chat/completions")) {
      let body = ""; req.on("data", chunk => body += chunk); req.on("end", () => {
        receivedBodies.push(body);
        const fail = body.includes("force-provider-error");
        if (fail) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: `provider error ${canary}` })); return; }
        const content = JSON.stringify({ round: 1, answers: [{ questionId: "Q1", decision: "accept", answer: "Keep the deployment reversible", rationale: `Unexpected provider echo ${canary}`, confidence: 0.42, assumptions: [] }] });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "eval", object: "chat.completion", created: 1, model: "eval-model", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 } }));
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}/v1`;
  const dir = await mkdtemp(join(tmpdir(), "jev-canary-"));
  const home = await mkdtemp(join(tmpdir(), "jev-home-"));
  try {
    await mkdir(join(home, ".config", "jev"), { recursive: true });
    await writeFile(join(home, ".config", "jev", "config.json"), JSON.stringify({ provider: "ollama", customBaseUrlConfirmed: endpoint }));
    const invoke = async (round: number, body: string) => {
      const request = JSON.stringify({ round, sessionId: "canary-session", questions: [{ questionId: "Q1", title: "Deployment", body, recommendation: "Keep the deployment reversible", dependsOn: [], risks: [] }] });
      const child = spawn(process.execPath, [cli, script], { cwd: dir, env: { PATH: process.env.PATH, HOME: home, JEV_PROVIDER: "ollama", JEV_MODEL: "eval-model", JEV_BASE_URL: endpoint, JEV_API_KEY: canary }, stdio: ["pipe", "pipe", "pipe"] });
      child.stdin.end(request);
      let stdout = "", stderr = ""; child.stdout.on("data", chunk => stdout += chunk); child.stderr.on("data", chunk => stderr += chunk);
      await new Promise<void>((resolveExit, reject) => { child.on("error", reject); child.on("exit", () => resolveExit()); });
      return { stdout, stderr, output: JSON.parse(stdout) };
    };
    const result = await invoke(1, `How should deployment work? Accidental credential: ${canary}`);
    const output = result.output;
    assert.equal(output.status, "needs-human");
    assert.equal(output.responses[0].provenance, "jev");
    assert.deepEqual(output.provider, { provider: "ollama", source: "local", variable: "none", masked: "none" });
    assert.equal(receivedBodies[0].includes(canary), false, "known secrets are removed before sending the prompt");
    const audit = await readFile(join(dir, ".grill", "canary-session.jsonl"), "utf8");
    const failed = await invoke(2, "force-provider-error");
    assert.equal(failed.output.status, "provider-error");
    assert.equal(`${result.stdout}${result.stderr}${failed.stdout}${failed.stderr}${audit}`.includes(canary), false);
    assert.match(result.stdout, /\[REDACTED\]/);
  } finally {
    await rm(dir, { recursive: true, force: true }); await rm(home, { recursive: true, force: true });
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  }
});
