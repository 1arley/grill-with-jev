// Post-record handoff (Q1-Q4 of session advisor-handoff-2026-10-20): ONE System One
// choice call that picks the single capability to load next for the confirmed
// record's first step. Opt-in (--advisor); the host assembles the catalog from
// visible skill cards + active MCP definitions, excluding built-in host tools.
// ponytail: no .grill budget ledger here — cost guard is one pre-call estimate
// against maxSessionCostUsd; reuse reserveSessionBudget from ask-jev.ts if
// multi-call advisor sessions ever need a hard cap.
import { z } from "zod";
import { findProviderKey } from "./find-provider-key.js";
import { estimatedTokens, pricing, ProviderRequestError, type TokenUsage } from "./ask-jev.js";
import { redact } from "./redact.js";

export const inputSchema = z.object({
  step: z.string().min(1),
  catalog: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    restriction: z.string().optional(),
  }).strict()).max(50),
  sessionId: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/).optional(),
}).strict().superRefine((input, ctx) => {
  const names = new Set<string>();
  input.catalog.forEach((entry, index) => {
    if (names.has(entry.name)) ctx.addIssue({ code: "custom", path: ["catalog", index], message: "duplicate capability name" });
    names.add(entry.name);
  });
});

type CatalogEntry = { name: string; description: string; restriction?: string };
type HandoffInput = { step: string; catalog: CatalogEntry[]; sessionId?: string };
export type HandoffOutput = {
  status: "next_skill" | "none" | "error";
  capability?: string;
  reason?: string;
  confidence?: number;
  probabilities?: string[];
  additional_work?: "unassessed";
  provenance?: "jev";
  sessionId?: string;
  model?: string;
  usage?: TokenUsage;
};

const questionId = "H1";

// Reuses the /v1/systemone choice route with a dynamic criteria map: one entry
// per candidate capability plus 'none'. choice === candidate name.
export function handoffQuestion(input: HandoffInput) {
  const criteria: Record<string, string> = { none: "No listed capability fits a meaningful first execution step." };
  for (const entry of input.catalog) {
    criteria[entry.name] = `${entry.description}${entry.restriction ? ` (${entry.restriction})` : ""}`;
  }
  const state = [
    `Approved decision record's first step: ${input.step}`,
    `Eligible capabilities (choose exactly one, or 'none'): ${JSON.stringify(input.catalog)}`,
  ].join("\n\n");
  return {
    state,
    body: {
      model: undefined as unknown as string,
      state,
      questions: {
        [questionId]: {
          type: "choice",
          instructions: "Choose the one capability that should be loaded next to execute the first step of the approved decision record. Use the exact capability names as choices; choose 'none' only when no listed capability can execute it.",
          criteria,
        },
      },
    },
  };
}

export function decideOffline(input: HandoffInput): HandoffOutput {
  if (input.catalog.length === 0) return { status: "none", reason: "empty catalog" };
  return {
    status: "next_skill", capability: input.catalog[0].name, confidence: 1, additional_work: "unassessed",
    provenance: "jev", reason: "deterministic offline mock picks the first catalog entry",
  };
}

async function main(): Promise<void> {
  const raw = await new Promise<string>((resolveInput, reject) => {
    let value = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => value += chunk);
    process.stdin.on("end", () => resolveInput(value)); process.stdin.on("error", reject);
  });
  let input: HandoffInput;
  let secrets: string[] = [];
  try {
    const parsed = inputSchema.parse(JSON.parse(raw));
    input = parsed;
  } catch { process.stdout.write('{"status":"invalid-request"}\n'); process.exitCode = 2; return; }
  const args = process.argv.slice(2);
  const mock = args.includes("--mock");
  const write = (output: { status: string; [key: string]: unknown }) => {
    process.stdout.write(`${JSON.stringify(redact(output, secrets))}\n`);
  };
  if (mock || input.catalog.length === 0) { write(decideOffline(input)); return; }

  const lookup = await findProviderKey();
  secrets = lookup.secrets;
  const sessionId = input.sessionId;
  if (lookup.consentRequired) { write({ status: "consent-required", consent: lookup.consentRequired, sessionId }); process.exitCode = 2; return; }
  if (!lookup.resolved) { write({ status: "no-provider-key", sessionId }); process.exitCode = 2; return; }
  const resolved = lookup.resolved;
  if (["typesafe", "opencode-zen"].includes(resolved.provider) && !resolved.baseUrl) {
    write({ status: "endpoint-required", provider: resolved.provider, model: resolved.model, sessionId });
    process.exitCode = 2; return;
  }
  const sessionPrice = ["ollama", "lm-studio"].includes(resolved.provider) ? undefined : pricing(lookup.config, process.env);
  if (!sessionPrice) { write({ status: "pricing-required", sessionId }); process.exitCode = 2; return; }
  const { state, body } = handoffQuestion(input);
  body.model = resolved.model ?? "";
  const inputEstimate = estimatedTokens(state) + 256;
  if (inputEstimate * sessionPrice.inputRate + 256 * sessionPrice.outputRate > sessionPrice.maxUsd * 1_000_000) {
    write({ status: "cost-limit", maxUsd: sessionPrice.maxUsd, sessionId }); process.exitCode = 2; return;
  }
  let usage: TokenUsage = {};
  try {
    const response = await fetch(new URL("/v1/systemone", resolved.baseUrl ?? "https://api.typesafe.ai/v1"), {
      method: "POST", redirect: "error" as const, signal: AbortSignal.timeout(45000),
      headers: { authorization: `Bearer ${resolved.key ?? ""}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    } satisfies Record<string, unknown>);
    if (!response.ok) throw new ProviderRequestError();
    const payload = await response.json() as {
      answers?: Record<string, { type: string; choice: string; confidence: number; probabilities: Record<string, number> }>;
      usage?: TokenUsage;
    };
    usage = payload.usage ?? {};
    const answer = payload.answers?.[questionId];
    if (answer?.type !== "choice") throw new ProviderRequestError();
    const top = Object.entries(answer.probabilities).sort((left, right) => right[1] - left[1]).slice(0, 2)
      .map(([name, value]) => `${name} ${value.toFixed(2)}`);
    if (answer.choice === "none") {
      write({ status: "none", reason: "no listed capability fits", confidence: answer.confidence, probabilities: top, sessionId, model: resolved.model, usage });
      return;
    }
    if (!input.catalog.some(entry => entry.name === answer.choice)) throw new ProviderRequestError();
    write({ status: "next_skill", capability: answer.choice, additional_work: "unassessed", provenance: "jev", confidence: answer.confidence, probabilities: top, sessionId, model: resolved.model, usage });
  } catch {
    const output: HandoffOutput = { status: "error", reason: "provider request failed", sessionId, model: resolved.model, usage };
    write(output);
    process.exitCode = 2;
  }
}

if (process.argv[1]?.endsWith("handoff-advisor.ts")) {
  main().catch(() => { process.stdout.write('{"status":"internal-error"}\n'); process.exitCode = 1; });
}
