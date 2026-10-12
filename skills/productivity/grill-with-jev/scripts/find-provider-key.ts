import { chmod, lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { maskedKey } from "./redact.js";

const execFileAsync = promisify(execFile);
export const providerOrder = ["typesafe", "openrouter", "ai-gateway", "opencode-zen", "anthropic", "openai", "gemini", "mistral", "groq", "xai", "deepseek", "together", "fireworks", "azure"] as const;
export const providerKeys: Record<string, string[]> = {
  typesafe: ["TYPESAFE_API_KEY"],
  "opencode-zen": ["OPENCODE_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"], openai: ["OPENAI_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"], "ai-gateway": ["AI_GATEWAY_API_KEY"],
  mistral: ["MISTRAL_API_KEY"], groq: ["GROQ_API_KEY"], xai: ["XAI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"], together: ["TOGETHER_API_KEY"],
  fireworks: ["FIREWORKS_API_KEY"], azure: ["AZURE_OPENAI_API_KEY"],
};
export const providerModels: Record<string, string> = {
  typesafe: "jev-latest", openrouter: "typesafe/jev-1.13",
  "ai-gateway": "typesafe-ai/jev", "opencode-zen": "jev-1.13-free",
};

export type JevConfig = {
  provider?: string; apiKey?: string; apiKeyProvider?: string; model?: string; baseUrl?: string;
  customBaseUrlConfirmed?: string; azureEndpoint?: string;
  dotenvConsent?: boolean; gatewayDotenvConsent?: boolean; secretManagerConsent?: boolean;
  secretManager?: { provider: string; variable: string; command: string[] };
  maxRounds?: number; confidenceThreshold?: number; maxSessionTokens?: number;
  maxSessionCostUsd?: number; inputUsdPerMillion?: number; outputUsdPerMillion?: number;
};
export type KeyReport = { provider: string; source: string; variable: string; masked: string };
export type ResolvedProvider = { provider: string; key?: string; model?: string; baseUrl?: string; report: KeyReport };
export type ProviderLookup = { resolved?: ResolvedProvider; config: JevConfig; consentRequired?: string; secrets: string[] };

export function parseDotenv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    values[match[1]] = value;
  }
  return values;
}

export function assertSafeBaseUrl(provider: string, baseUrl: string | undefined, config: JevConfig): URL | undefined {
  if (!baseUrl) return undefined;
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error("Invalid provider endpoint."); }
  if (url.username || url.password || url.search || url.hash) throw new Error("Provider endpoint contains a forbidden URL component.");
  const host = url.hostname.toLowerCase();
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  if (local && ["ollama", "lm-studio"].includes(provider)) {
    if (!(["http:", "https:"].includes(url.protocol))) throw new Error("Local provider endpoint must use HTTP(S).");
    return url;
  }
  if (provider === "azure" && url.protocol === "https:" && host.endsWith(".openai.azure.com")) return url;
  const official: Record<string, string[]> = {
    anthropic: ["api.anthropic.com"], openai: ["api.openai.com"],
    gemini: ["generativelanguage.googleapis.com"], openrouter: ["openrouter.ai"],
    "ai-gateway": ["ai-gateway.vercel.sh"], mistral: ["api.mistral.ai"], groq: ["api.groq.com"],
    xai: ["api.x.ai"], deepseek: ["api.deepseek.com"], together: ["api.together.xyz"],
    fireworks: ["api.fireworks.ai"],
  };
  if (url.protocol === "https:" && official[provider]?.includes(host)) return url;
  if (config.provider?.toLowerCase() === provider && config.customBaseUrlConfirmed === baseUrl && url.protocol === "https:") return url;
  throw new Error("Custom provider endpoints require a matching confirmation in ~/.config/jev/config.json.");
}

async function readConfig(path: string): Promise<JevConfig> {
  try { return JSON.parse(await readFile(path, "utf8")) as JevConfig; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw new Error("JEV configuration is unreadable or invalid."); }
}

async function projectRoots(cwd: string): Promise<string[]> {
  const roots = [resolve(cwd)];
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 1500, maxBuffer: 2048 });
    const repo = resolve(stdout.trim());
    if (!roots.includes(repo)) roots.push(repo);
  } catch { /* A project need not be a Git checkout. */ }
  return roots;
}

async function askConsent(question: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return /^y(?:es)?$/i.test((await rl.question(`${question} [y/N] `)).trim()); }
  finally { rl.close(); }
}

export async function findProviderKey(options: {
  cwd?: string; env?: NodeJS.ProcessEnv; homeDir?: string; configPath?: string; dotenvValues?: Record<string, string>;
} = {}): Promise<ProviderLookup> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const configPath = options.configPath ?? join(homeDir, ".config", "jev", "config.json");
  const config = await readConfig(configPath);
  const roots = await projectRoots(cwd);
  let dotenv: Record<string, string> = options.dotenvValues ?? {};
  const keyNames = ["JEV_API_KEY", ...Object.values(providerKeys).flat()];
  const envNames = ["JEV_PROVIDER", "JEV_API_KEY", "JEV_MODEL", "JEV_BASE_URL", ...Object.values(providerKeys).flat()];
  const dotenvSecrets = Object.entries(dotenv).filter(([name, value]) => keyNames.includes(name) && value).map(([, value]) => value);
  if (!options.dotenvValues) {
    const candidates = [
      ...(config.gatewayDotenvConsent ? [[join(homeDir, ".jev-gateway"), ".env"] as const] : []),
      ...(config.dotenvConsent ? roots.flatMap(root => [".env", ".env.local", ".env.development"].map(name => [root, name] as const)) : []),
    ];
    for (const [root, name] of candidates) {
      try {
        const path = join(root, name);
        const canonical = await realpath(path);
        const rel = relative(resolve(root), canonical);
        if (!(await lstat(path)).isFile() || rel === ".." || rel.startsWith(`..${sep}`) || resolve(rel) === rel) continue;
        const parsed = parseDotenv(await readFile(path, "utf8"));
        const allowed = Object.fromEntries(envNames.filter(key => parsed[key]).map(key => [key, parsed[key]]));
        dotenvSecrets.push(...Object.entries(allowed).filter(([key]) => keyNames.includes(key)).map(([, value]) => value));
        dotenv = { ...dotenv, ...allowed };
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("An approved dotenv file could not be read."); }
    }
  }

  const processKeyProvider = providerOrder.find(name => providerKeys[name].some(key => env[key]));
  const dotenvKeyProvider = providerOrder.find(name => providerKeys[name].some(key => dotenv[key]));
  const provider = env.JEV_PROVIDER?.toLowerCase() ?? processKeyProvider
    ?? dotenv.JEV_PROVIDER?.toLowerCase() ?? dotenvKeyProvider ?? config.provider?.toLowerCase();
  const matchingConfig = config.provider?.toLowerCase() === provider;
  const matchingKeyConfig = (config.apiKeyProvider ?? config.provider)?.toLowerCase() === provider;
  const secrets = [...keyNames.map(name => env[name]), ...dotenvSecrets, config.apiKey].filter((value): value is string => Boolean(value));
  if (!provider && (env.JEV_API_KEY || config.apiKey)) throw new Error("Set JEV_PROVIDER to choose a provider for JEV_API_KEY.");
  if (!provider) {
    if (!options.dotenvValues && config.dotenvConsent === undefined) return { config, consentRequired: "dotenv", secrets };
    if (!options.dotenvValues && config.gatewayDotenvConsent === undefined) return { config, consentRequired: "gateway-dotenv", secrets };
    return { config, secrets };
  }
  if (provider === "ollama" || provider === "lm-studio") {
    const requestedBaseUrl = env.JEV_BASE_URL ?? dotenv.JEV_BASE_URL;
    const baseUrl = requestedBaseUrl ?? (matchingConfig ? config.baseUrl : undefined) ?? (provider === "ollama" ? "http://127.0.0.1:11434/v1" : "http://127.0.0.1:1234/v1");
    if (requestedBaseUrl && (!matchingConfig || config.customBaseUrlConfirmed !== baseUrl)) throw new Error("JEV_BASE_URL requires explicit confirmation recorded for this provider in config.json.");
    assertSafeBaseUrl(provider, baseUrl, config);
    return { config, secrets, resolved: { provider, model: env.JEV_MODEL ?? dotenv.JEV_MODEL ?? (matchingConfig ? config.model : undefined), baseUrl, report: { provider, source: "local", variable: "none", masked: "none" } } };
  }
  if (!providerKeys[provider]) throw new Error("Unsupported provider.");

  let key = env.JEV_API_KEY;
  let source = "env";
  let variable = key ? "JEV_API_KEY" : "";
  if (!key) for (const candidate of providerKeys[provider]) if (env[candidate]) { key = env[candidate]; variable = candidate; break; }
  if (!key && dotenv.JEV_API_KEY) { key = dotenv.JEV_API_KEY; source = "dotenv"; variable = "JEV_API_KEY"; }
  if (!key) for (const candidate of providerKeys[provider]) if (dotenv[candidate]) { key = dotenv[candidate]; source = "dotenv"; variable = candidate; break; }
  if (!key && matchingKeyConfig && config.apiKey) { key = config.apiKey; source = "config"; variable = "apiKey"; }
  if (!key && !options.dotenvValues && config.dotenvConsent === undefined) return { config, consentRequired: "dotenv", secrets };
  if (!key && !options.dotenvValues && config.gatewayDotenvConsent === undefined) return { config, consentRequired: "gateway-dotenv", secrets };
  if (!key && config.secretManager?.provider === provider && config.secretManager.command.length && config.secretManager.variable) {
    if (!config.secretManagerConsent) return { config, consentRequired: "secret-manager", secrets };
    const [command, ...args] = config.secretManager.command;
    try {
      const result = await execFileAsync(command, args, { timeout: 5000, maxBuffer: 4096, windowsHide: true });
      key = result.stdout.trim(); source = "command"; variable = config.secretManager.variable;
      if (key) secrets.push(key);
    } catch { throw new Error("Configured secret-manager command failed; its output was suppressed."); }
  }
  if (!key) return { config, secrets };

  let baseUrl = env.JEV_BASE_URL ?? dotenv.JEV_BASE_URL ?? (matchingConfig ? config.baseUrl : undefined);
  if (provider === "azure") baseUrl = env.AZURE_OPENAI_ENDPOINT ?? config.azureEndpoint ?? baseUrl;
  if (baseUrl && (env.JEV_BASE_URL || dotenv.JEV_BASE_URL) && (!matchingConfig || config.customBaseUrlConfirmed !== baseUrl)) throw new Error("JEV_BASE_URL requires explicit confirmation recorded for this provider in config.json.");
  if (baseUrl) assertSafeBaseUrl(provider, baseUrl, config);
  if (provider === "azure" && !baseUrl) throw new Error("Azure OpenAI requires AZURE_OPENAI_ENDPOINT.");
  return {
    config, secrets,
    resolved: {
      provider, key, model: env.JEV_MODEL ?? dotenv.JEV_MODEL ?? (matchingConfig ? config.model : undefined) ?? providerModels[provider],
      baseUrl, report: { provider, source, variable, masked: maskedKey(key) },
    },
  };
}

export async function saveConfig(config: JevConfig, configPath = join(homedir(), ".config", "jev", "config.json")): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  const temporary = `${configPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, configPath);
  await chmod(configPath, 0o600);
}
