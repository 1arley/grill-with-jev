import { z } from "zod";
import { JevRound, validateCoverage, type JevRound as JevRoundType } from "./schema.js";

export type AttemptResult = { value: unknown } | { validationError: string[] };

export async function retryInvalidRound(
  run: (feedback?: string[]) => Promise<AttemptResult>, expectedIds: string[], recommendations: Record<string, string> = {}, expectedRound?: number,
): Promise<{ round?: JevRoundType; errors: string[]; attempts: number }> {
  let feedback: string[] = [];
  for (let attempts = 1; attempts <= 2; attempts++) {
    const result = await run(feedback.length ? feedback : undefined);
    if ("validationError" in result) feedback = result.validationError;
    else {
      const parsed = JevRound.safeParse(result.value);
      feedback = parsed.success
        ? [
            ...(expectedRound !== undefined && parsed.data.round !== expectedRound ? [`round must equal ${expectedRound}`] : []),
            ...validateCoverage(parsed.data, expectedIds),
            ...parsed.data.answers.filter(answer => answer.decision === "accept" && recommendations[answer.questionId] !== answer.answer).map(answer => `accept answer must repeat recommendation for ${answer.questionId}`),
          ]
        : parsed.error.issues.slice(0, 20).map(issue => `${issue.path.join(".") || "<root>"}: ${issue.code}`);
      if (parsed.success && feedback.length === 0) return { round: parsed.data, errors: [], attempts };
    }
    if (attempts === 2) return { errors: feedback, attempts };
  }
  return { errors: feedback, attempts: 2 };
}
