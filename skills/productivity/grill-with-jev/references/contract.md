# JEV response contract

`scripts/schema.ts` defines the only provider response accepted by the skill. It uses Zod 4 and exports the JSON Schema as `JevRoundJSONSchema` with `z.toJSONSchema(JevRound)`.

```ts
export const JevAnswer = z.object({
  questionId: z.string().regex(/^Q\d+$/),
  decision: z.enum(["accept", "amend", "reject", "escalate"]),
  answer: z.string().min(1),
  rationale: z.string().max(400),
  confidence: z.number().min(0).max(1),
  assumptions: z.array(z.string()).default([]),
}).strict();

export const JevRound = z.object({
  round: z.number().int().positive(),
  answers: z.array(JevAnswer).min(1),
}).strict();
```

The script checks that input question IDs are unique, the returned round matches the submitted round, and every question ID appears exactly once with no extras. An accepted answer must repeat its recommendation. It retries a schema or coverage failure once with safe validator paths/codes; a second failure escalates every question in that round.

The script marks an answer for the human when JEV chooses `escalate`, confidence is below the configured threshold (default `0.6`), or the question is classified as irreversible, security-sensitive, about money, or involving third-party data. Risk labels are supplied by the host and reinforced by a small keyword check; the agent must classify meaning, not rely on keywords alone. JEV's answer is evidence, not approval, for these cases.

The JSON output carries `provenance: "jev"` and `settled` on each model answer. `settled` is false when the answer escalates for a decision, confidence, risk, or session-budget reason. Preserve it in the next request's transcript; only a transcript entry whose latest `settled` value is true can unblock dependent questions. Human replies and sub-agent decisions are added by the host with provenance `user` and `jev-subagent`; mark a human reply settled after the user answers. The audit JSONL is not a replacement for the final `decision-record.md`.

The script uses the current AI SDK structured output API (`generateText` + `Output.object({ schema })`) and independently checks with Zod before returning anything. It never accepts partial streaming output.
