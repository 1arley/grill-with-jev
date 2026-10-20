---
name: grill-with-jev
description: Grill a plan or design in rounds where JEV, the user's automated stand-in, decides through schema-validated answers. Use only when explicitly invoked.
disable-model-invocation: true
---

# Grill with JEV

Use only after explicit invocation; each JEV call may spend API credits. Read [security.md](references/security.md) before setup and [contract.md](references/contract.md) when handling script output.

Build a design tree and ask the whole frontier in rounds. The host agent owns fact finding (and may delegate research); JEV decides and never researches. Keep dependent questions for a later round. Show each round to the user in this format before asking JEV:

```text
❓ **Q1** - **<title>**: <question>

➡️ <recommended answer>
```

Word questions so “yes” accepts the recommendation. Send the round as JSON on stdin to `scripts/ask-jev.ts`, using the same session ID on every call; a session ID is one grill — probes and dry-runs permanently consume its round numbers, so a real grill starts fresh with a new ID. Include each question's decision dependencies in `dependsOn`; the script rejects unresolved dependencies and questions that depend on another question in the same round. When carrying answers forward, preserve each response's `settled` value; an escalated answer cannot unblock dependent questions. Mark human answers `settled: true`. Include only relevant allowlisted Markdown paths as `contextFiles`; never paste credentials or `.env` contents. Add risk labels for irreversible actions, security, money, and third-party data. The script's keyword scan may also flag benign words ("deploy", "migration"); classify the action's meaning yourself and reclassify a flag rather than repeating it blindly. The script redacts inputs and outputs, validates the response, records `.grill/<session>.jsonl`, and returns provenance `jev`.

If the script asks for dotenv or secret-manager consent, ask the real user first; save only their explicit choice with `scripts/setup.ts`. If no key is found, offer these fallbacks in order: help locate a key or run setup; ask a JEV sub-agent using only the profile and round, marked `jev-subagent`; ask the user in the original format. Never impersonate JEV silently. Ask the user only about escalations, consent, budget/round limits, or their unsolicited corrections; record those answers as `user`.

Recompute the frontier after every round and repeat until it is empty. Stop and ask the user if the script reports a budget, round, sequence, or session-busy limit. Then write `decision-record.md` with decisions, provenance, assumptions, and open risks. Ask the real user once to confirm that record before acting; skip only when the invocation explicitly includes `--autonomous`.

For profile setup, collect only sources the user authorizes, draft the profile, show it, and save with `setup.ts --save-profile repo|global --approved` only after approval. Keep detailed setup, provider, and secret-handling steps in the linked references.
