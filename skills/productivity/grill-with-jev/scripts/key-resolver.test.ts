import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertSafeBaseUrl, findProviderKey, parseDotenv } from "./find-provider-key.js";

test("parses dotenv text without shell evaluation", () => {
  assert.deepEqual(parseDotenv("export OPENAI_API_KEY='one two'\nOTHER=$(touch /tmp/nope)\n# ignored"), { OPENAI_API_KEY: "one two", OTHER: "$(touch /tmp/nope)" });
});

test("process configuration wins and key reports remain masked", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-key-"));
  try {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "openai", model: "chosen-model", apiKey: "config-secret" }));
    const found = await findProviderKey({ cwd: dir, homeDir: dir, configPath, env: { JEV_PROVIDER: "openai", JEV_API_KEY: "process-secret" }, dotenvValues: {} });
    assert.equal(found.resolved?.key, "process-secret");
    assert.deepEqual(found.resolved?.report, { provider: "openai", source: "env", variable: "JEV_API_KEY", masked: "***cret" });
    assert.ok(!JSON.stringify(found.resolved?.report).includes("process-secret"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("allowlisted process keys take precedence over dotenv and saved provider choices", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-provider-priority-"));
  try {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "anthropic", apiKey: "saved-secret" }));
    const found = await findProviderKey({ cwd: dir, homeDir: dir, configPath, env: { OPENAI_API_KEY: "process-secret" }, dotenvValues: { ANTHROPIC_API_KEY: "dotenv-secret" } });
    assert.equal(found.resolved?.provider, "openai");
    assert.equal(found.resolved?.key, "process-secret");
    assert.equal(found.resolved?.report.source, "env");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a stored key remains bound to its provider after setup changes the model provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-provider-key-binding-"));
  try {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "openai", apiKeyProvider: "anthropic", apiKey: "old-provider-secret", model: "new-model", dotenvConsent: true }));
    const found = await findProviderKey({ cwd: dir, homeDir: dir, configPath, env: {} });
    assert.equal(found.resolved, undefined);
    assert.equal(found.secrets.includes("old-provider-secret"), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("dotenv is not read before consent and only approved names are extracted after consent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-dotenv-"));
  try {
    await writeFile(join(dir, ".env"), "OPENAI_API_KEY=dotenv-canary\nUNRELATED_SECRET=ignored");
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "openai" }));
    const denied = await findProviderKey({ cwd: dir, homeDir: dir, configPath, env: {} });
    assert.equal(denied.consentRequired, "dotenv");
    await writeFile(configPath, JSON.stringify({ provider: "openai", dotenvConsent: true }));
    const approved = await findProviderKey({ cwd: dir, homeDir: dir, configPath, env: {} });
    assert.equal(approved.resolved!.key, "dotenv-canary");
    assert.equal(approved.resolved!.report.source, "dotenv");
    assert.ok(!approved.secrets.includes("ignored"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("denied dotenv consent is remembered and skips dotenv without prompting again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-dotenv-denied-"));
  try {
    await writeFile(join(dir, ".env"), "OPENAI_API_KEY=must-not-read");
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "openai", dotenvConsent: false, gatewayDotenvConsent: false }));
    const found = await findProviderKey({ cwd: dir, homeDir: dir, configPath, env: {} });
    assert.equal(found.consentRequired, undefined);
    assert.equal(found.resolved, undefined);
    assert.equal(found.secrets.includes("must-not-read"), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a consented provider key in dotenv selects its provider when no provider is configured", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-dotenv-provider-"));
  try {
    await writeFile(join(dir, ".env.local"), "OPENAI_API_KEY=dotenv-canary\nJEV_MODEL=dotenv-model");
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ dotenvConsent: true, gatewayDotenvConsent: true }));
    const found = await findProviderKey({ cwd: dir, homeDir: dir, configPath, env: {} });
    assert.equal(found.resolved?.provider, "openai");
    assert.equal(found.resolved?.model, "dotenv-model");
    assert.equal(found.resolved?.report.source, "dotenv");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("dotenv filenames outside the allowlist are ignored", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-dotenv-name-"));
  try {
    await writeFile(join(dir, ".env.production"), "OPENAI_API_KEY=ignored-secret");
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ dotenvConsent: true, gatewayDotenvConsent: true }));
    const found = await findProviderKey({ cwd: dir, homeDir: dir, configPath, env: {} });
    assert.equal(found.resolved, undefined);
    assert.equal(found.secrets.includes("ignored-secret"), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("dotenv symlinks outside the project are ignored", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-symlink-"));
  const outside = await mkdtemp(join(tmpdir(), "jev-outside-"));
  try {
    await writeFile(join(outside, "secret"), "OPENAI_API_KEY=outside-secret");
    await import("node:fs/promises").then(fs => fs.symlink(join(outside, "secret"), join(dir, ".env")));
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "openai", dotenvConsent: true }));
    const found = await findProviderKey({ cwd: dir, homeDir: dir, configPath, env: {} });
    assert.equal(found.resolved, undefined);
  } finally { await rm(dir, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test("the gateway dotenv file resolves only the listed providers after dotenv consent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-gateway-dotenv-"));
  try {
    await mkdir(join(dir, ".jev-gateway"), { recursive: true });
    await writeFile(join(dir, ".jev-gateway", ".env"), [
      "TYPESAFE_API_KEY=typesafe-canary",
      "OPENROUTER_API_KEY=openrouter-canary",
      "AI_GATEWAY_API_KEY=gateway-canary",
      "OPENCODE_API_KEY=opencode-canary",
      "UNRELATED_SECRET=must-not-retain",
    ].join("\n"));
    const configPath = join(dir, "config.json");
    const pending = await findProviderKey({ cwd: dir, homeDir: dir, configPath, env: { JEV_PROVIDER: "typesafe" } });
    assert.equal(pending.consentRequired, "dotenv");
    assert.equal(pending.resolved, undefined);
    await writeFile(configPath, JSON.stringify({ dotenvConsent: true, gatewayDotenvConsent: true }));
    const providers = [
      ["typesafe", "TYPESAFE_API_KEY", "typesafe-canary", "jev-latest"],
      ["openrouter", "OPENROUTER_API_KEY", "openrouter-canary", "typesafe/jev-1.13"],
      ["ai-gateway", "AI_GATEWAY_API_KEY", "gateway-canary", "typesafe-ai/jev"],
      ["opencode-zen", "OPENCODE_API_KEY", "opencode-canary", "jev-1.13-free"],
    ] as const;
    for (const [provider, variable, key, model] of providers) {
      const found = await findProviderKey({ cwd: dir, homeDir: dir, configPath, env: { JEV_PROVIDER: provider } });
      assert.equal(found.resolved?.provider, provider);
      assert.equal(found.resolved?.key, key);
      assert.equal(found.resolved?.model, model);
      assert.deepEqual(found.resolved?.report, { provider, source: "dotenv", variable, masked: `***${key.slice(-4)}` });
      assert.equal(found.secrets.includes("must-not-retain"), false);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("overridden dotenv keys remain registered for output redaction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-dotenv-redaction-"));
  try {
    await mkdir(join(dir, ".jev-gateway"), { recursive: true });
    await writeFile(join(dir, ".jev-gateway", ".env"), "OPENAI_API_KEY=old-gateway-canary");
    await writeFile(join(dir, ".env"), "OPENAI_API_KEY=project-canary");
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ dotenvConsent: true, gatewayDotenvConsent: true }));
    const found = await findProviderKey({ cwd: dir, homeDir: dir, configPath, env: { JEV_PROVIDER: "openai" } });
    assert.equal(found.resolved?.key, "project-canary");
    assert.ok(found.secrets.includes("old-gateway-canary"));
    assert.ok(found.secrets.includes("project-canary"));
    assert.ok(!JSON.stringify(found.resolved?.report).includes("project-canary"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the gateway dotenv path is not read when dotenv access was denied", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-gateway-dotenv-denied-"));
  try {
    await mkdir(join(dir, ".jev-gateway"), { recursive: true });
    await writeFile(join(dir, ".jev-gateway", ".env"), "TYPESAFE_API_KEY=must-not-read");
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "typesafe", dotenvConsent: false, gatewayDotenvConsent: false }));
    const found = await findProviderKey({ cwd: dir, homeDir: dir, configPath, env: {} });
    assert.equal(found.resolved, undefined);
    assert.equal(found.secrets.includes("must-not-read"), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("legacy project dotenv consent does not authorize the gateway dotenv file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-gateway-migration-"));
  try {
    await mkdir(join(dir, ".jev-gateway"), { recursive: true });
    await writeFile(join(dir, ".jev-gateway", ".env"), "TYPESAFE_API_KEY=private-gateway-key");
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "typesafe", dotenvConsent: true }));
    const pending = await findProviderKey({ cwd: dir, homeDir: dir, configPath, env: {} });
    assert.equal(pending.consentRequired, "gateway-dotenv");
    assert.equal(pending.resolved, undefined);
    assert.equal(pending.secrets.includes("private-gateway-key"), false);
    await writeFile(configPath, JSON.stringify({ provider: "typesafe", dotenvConsent: true, gatewayDotenvConsent: true }));
    const approved = await findProviderKey({ cwd: dir, homeDir: dir, configPath, env: {} });
    assert.equal(approved.resolved?.key, "private-gateway-key");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("custom endpoints require exact confirmation and official hosts are accepted", () => {
  assert.equal(assertSafeBaseUrl("openai", "https://api.openai.com/v1", {})!.hostname, "api.openai.com");
  assert.throws(() => assertSafeBaseUrl("openai", "https://elsewhere.example/v1", {}), /confirmation/);
  assert.equal(assertSafeBaseUrl("typesafe", "https://api.example/v1", { provider: "typesafe", customBaseUrlConfirmed: "https://api.example/v1" })!.hostname, "api.example");
  assert.throws(() => assertSafeBaseUrl("typesafe", "https://api.example/v1", { provider: "openrouter", customBaseUrlConfirmed: "https://api.example/v1" }), /confirmation/);
  assert.equal(assertSafeBaseUrl("ollama", "http://localhost:11434/v1", {})!.hostname, "localhost");
  assert.throws(() => assertSafeBaseUrl("openai", "http://localhost:9999/v1", { customBaseUrlConfirmed: "http://localhost:9999/v1" }), /confirmation/);
});

test("a confirmed local System One gateway may use plain HTTP on loopback only", () => {
  const confirmed = { provider: "opencode-zen", customBaseUrlConfirmed: "http://localhost:20128/v1" };
  assert.equal(assertSafeBaseUrl("opencode-zen", "http://localhost:20128/v1", confirmed)!.hostname, "localhost");
  assert.equal(assertSafeBaseUrl("opencode-zen", "http://127.0.0.1:20128/v1", { provider: "opencode-zen", customBaseUrlConfirmed: "http://127.0.0.1:20128/v1" })!.hostname, "127.0.0.1");
  assert.throws(() => assertSafeBaseUrl("opencode-zen", "http://localhost:20128/v1", {}), /confirmation/);
  const remote = { provider: "opencode-zen", customBaseUrlConfirmed: "http://zen.example/v1" };
  assert.throws(() => assertSafeBaseUrl("opencode-zen", "http://zen.example/v1", remote), /confirmation/);
  assert.throws(() => assertSafeBaseUrl("opencode-zen", "https://zen.example/v1", remote), /confirmation/);
});

test("the advisor gateway provider name reuses saved gateway credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-alias-"));
  try {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "openai" }));
    const found = await findProviderKey({ cwd: dir, homeDir: dir, configPath, env: { JEV_PROVIDER: "opencode", OPENCODE_API_KEY: "gateway-secret" }, dotenvValues: {} });
    assert.equal(found.resolved?.provider, "opencode-zen");
    assert.equal(found.resolved?.key, "gateway-secret");
    assert.equal(found.resolved?.model, "jev-1.13-free");
    assert.equal(found.resolved?.report.variable, "OPENCODE_API_KEY");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a confirmed loopback JEV_BASE_URL resolves without overrides", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-loopback-"));
  try {
    const configPath = join(dir, "config.json");
    await writeFile(configPath, JSON.stringify({ provider: "opencode-zen", baseUrl: "http://localhost:20128/v1", customBaseUrlConfirmed: "http://localhost:20128/v1" }));
    const found = await findProviderKey({ cwd: dir, homeDir: dir, configPath, env: { OPENCODE_API_KEY: "gateway-secret" }, dotenvValues: {} });
    assert.equal(found.resolved?.provider, "opencode-zen");
    assert.equal(found.resolved?.baseUrl, "http://localhost:20128/v1");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

