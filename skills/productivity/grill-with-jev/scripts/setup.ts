import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findProviderKey, normalizeProvider, providerKeys, saveConfig, type JevConfig } from "./find-provider-key.js";
import { redact, maskedKey } from "./redact.js";
import { readApprovedMarkdown } from "./safe-files.js";

const execFileAsync = promisify(execFile);
const configPath = join(homedir(), ".config", "jev", "config.json");
const args = process.argv.slice(2);
const get = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const flag = (name: string) => args.includes(name);
const allowedProviders = new Set(["typesafe", "openrouter", "ai-gateway", "opencode-zen", "anthropic", "openai", "gemini", "mistral", "groq", "xai", "deepseek", "together", "fireworks", "azure", "ollama", "lm-studio"]);

async function config(): Promise<JevConfig> {
  try { return JSON.parse(await readFile(configPath, "utf8")) as JevConfig; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw new Error("invalid config"); }
}

async function knownSecrets(): Promise<string[]> {
  const cfg = await config();
  return [cfg.apiKey, process.env.JEV_API_KEY, ...Object.values(providerKeys).flatMap(names => names.map(name => process.env[name]))].filter((value): value is string => Boolean(value));
}

async function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) throw new Error("interactive terminal required");
  process.stderr.write(prompt);
  process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolveInput, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      process.stdin.off("data", onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stderr.write("\n");
      error ? reject(error) : resolveInput(value);
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") return finish(new Error("cancelled"));
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function readStdin(): Promise<string> {
  let text = "";
  for await (const chunk of process.stdin) text += chunk.toString();
  return text;
}

async function collectSources(paths: string[]): Promise<void> {
  const cwd = resolve(process.cwd());
  const sources: { path: string; text: string }[] = [];
  const secrets = await knownSecrets();
  for (const path of paths) {
    const source = await readApprovedMarkdown(cwd, path);
    sources.push({ path: source.path, text: String(redact(source.text, secrets)) });
  }
  if (flag("--git-log")) {
    const { stdout } = await execFileAsync("git", ["log", "-n", "40", "--format=%s"], { cwd, timeout: 2000, maxBuffer: 20000 });
    sources.push({ path: "git log subjects", text: String(redact(stdout, secrets)) });
  }
  process.stdout.write(`${JSON.stringify({ sources })}\n`);
}

async function run(): Promise<void> {
  if (flag("--collect-sources")) {
    const marker = args.indexOf("--collect-sources");
    const end = args.findIndex((arg, i) => i > marker && arg.startsWith("--"));
    await collectSources(args.slice(marker + 1, end < 0 ? undefined : end));
    return;
  }

  if (flag("--save-profile")) {
    if (!flag("--approved")) throw new Error("profile save requires --approved after the user approves the displayed draft");
    const scope = get("--save-profile");
    if (scope !== "repo" && scope !== "global") throw new Error("profile scope must be repo or global");
    const draft = (await readStdin()).trim();
    if (!draft) throw new Error("profile draft is empty");
    const secrets = await knownSecrets();
    const target = scope === "global" ? join(homedir(), ".config", "jev", "profile.md") : resolve(".jev", "profile.md");
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, `${String(redact(draft, secrets))}\n`, { mode: 0o600 });
    await chmod(target, 0o600);
    process.stdout.write(`${JSON.stringify({ saved: scope, path: scope === "global" ? "~/.config/jev/profile.md" : ".jev/profile.md" })}\n`);
    return;
  }

  if (flag("--set-key")) {
    const provider = get("--set-key")?.toLowerCase();
    if (!provider || !allowedProviders.has(provider) || !flag("--approved")) throw new Error("set-key requires a supported provider and --approved");
    const key = await readHidden(`API key for ${provider} (input is hidden): `);
    if (!key) throw new Error("empty key");
    const cfg = await config(); Object.assign(cfg, { provider, apiKeyProvider: provider, apiKey: key }); await saveConfig(cfg, configPath);
    process.stdout.write(`${JSON.stringify({ provider, source: "config", variable: "apiKey", masked: maskedKey(key) })}\n`);
    return;
  }

  if (["--consent-dotenv", "--deny-dotenv", "--consent-gateway-dotenv", "--deny-gateway-dotenv", "--consent-secret-manager"].some(flag)) {
    if (!flag("--approved")) throw new Error("consent can be stored only after explicit user approval");
    const cfg = await config();
    if (flag("--consent-dotenv") && flag("--deny-dotenv")) throw new Error("choose one dotenv consent decision");
    if (flag("--consent-gateway-dotenv") && flag("--deny-gateway-dotenv")) throw new Error("choose one gateway dotenv consent decision");
    if (flag("--consent-dotenv")) cfg.dotenvConsent = true;
    if (flag("--consent-dotenv")) cfg.gatewayDotenvConsent = true;
    if (flag("--deny-dotenv")) { cfg.dotenvConsent = false; cfg.gatewayDotenvConsent = false; }
    if (flag("--consent-gateway-dotenv")) cfg.gatewayDotenvConsent = true;
    if (flag("--deny-gateway-dotenv")) cfg.gatewayDotenvConsent = false;
    if (flag("--consent-secret-manager")) cfg.secretManagerConsent = true;
    await saveConfig(cfg, configPath); process.stdout.write('{"saved":"consent"}\n'); return;
  }

  if (flag("--set-model")) {
    const provider = get("--set-model")?.toLowerCase(); const model = args[args.indexOf("--set-model") + 2];
    if (!provider || !allowedProviders.has(provider) || !model || !flag("--approved")) throw new Error("set-model requires provider, model, and --approved");
    const cfg = await config(); cfg.provider = provider; cfg.model = model; await saveConfig(cfg, configPath);
    process.stdout.write(`${JSON.stringify({ saved: "model", provider, model })}\n`); return;
  }

  if (flag("--confirm-base-url")) {
    const baseUrl = get("--confirm-base-url");
    if (!baseUrl || !flag("--approved")) throw new Error("custom endpoint confirmation requires --approved");
    const provider = normalizeProvider(get("--provider"))?.toLowerCase();
    if (!provider || !allowedProviders.has(provider)) throw new Error("custom endpoint requires a supported --provider");
    const cfg = await config(); cfg.provider = provider; cfg.baseUrl = baseUrl; cfg.customBaseUrlConfirmed = baseUrl;
    await saveConfig(cfg, configPath); process.stdout.write(JSON.stringify({ saved: "endpoint", provider, host: new URL(baseUrl).host }) + "\n"); return;
  }

  if (flag("--set-manager")) {
    const provider = get("--set-manager")?.toLowerCase(); const variable = args[args.indexOf("--set-manager") + 2];
    const commandAt = args.indexOf("--command"); const command = commandAt < 0 ? [] : args.slice(commandAt + 1);
    if (!provider || !allowedProviders.has(provider) || !variable || !/^([A-Z_][A-Z0-9_]*)$/.test(variable) || !command.length || !flag("--approved")) throw new Error("secret manager requires provider, variable, exact argv, and --approved");
    const cfg = await config(); cfg.secretManager = { provider, variable, command }; cfg.secretManagerConsent = false;
    await saveConfig(cfg, configPath); process.stdout.write('{"saved":"secret-manager-command","consentRequired":true}\n'); return;
  }

  if (flag("--pricing")) {
    const numbers = ["--input-usd-per-million", "--output-usd-per-million", "--max-usd"].map(get).map(Number);
    if (numbers.some(value => !Number.isFinite(value) || value < 0) || numbers[2] <= 0 || !flag("--approved")) throw new Error("pricing requires non-negative rates, a positive cost ceiling, and approval");
    const cfg = await config(); [cfg.inputUsdPerMillion, cfg.outputUsdPerMillion, cfg.maxSessionCostUsd] = numbers;
    await saveConfig(cfg, configPath); process.stdout.write('{"saved":"pricing"}\n'); return;
  }

  const found = await findProviderKey({ configPath });
  process.stdout.write(`${JSON.stringify({ configured: Boolean(found.resolved), consentRequired: found.consentRequired ?? null })}\n`);
}

run().catch(() => { process.stderr.write("jev setup failed; details were suppressed for safety.\n"); process.exitCode = 1; });
