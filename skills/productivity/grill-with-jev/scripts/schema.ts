import { z } from "zod";

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

export const JevRoundJSONSchema = z.toJSONSchema(JevRound);
export type JevAnswer = z.infer<typeof JevAnswer>;
export type JevRound = z.infer<typeof JevRound>;

export function validateCoverage(round: JevRound, expectedIds: string[]): string[] {
  const actualIds = round.answers.map(answer => answer.questionId);
  const duplicates = actualIds.filter((id, index) => actualIds.indexOf(id) !== index);
  const expected = new Set(expectedIds);
  const actual = new Set(actualIds);
  return [
    ...duplicates.map(id => `duplicate question id: ${id}`),
    ...expectedIds.filter(id => !actual.has(id)).map(id => `missing question id: ${id}`),
    ...actualIds.filter(id => !expected.has(id)).map(id => `unexpected question id: ${id}`),
  ];
}
