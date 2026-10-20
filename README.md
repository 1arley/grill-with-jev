# Grill with JEV

An explicitly invoked variant of Matt Pocock's MIT-licensed `grilling` skill. The agent maps a decision tree and asks each frontier in rounds; JEV, an automated stand-in for the user, returns validated decisions. The human still answers escalations and confirms the completed decision record before the agent acts.

JEV is the user's persona. It decides from an approved profile, selected project documents, and the session transcript. The host agent remains responsible for facts; JEV does not browse or research. The profile may contain values, preferences, criteria, vetoes, style, and real past decisions. Answers use a Zod contract exported as JSON Schema, are checked before use, and carry `user`, `jev`, or `jev-subagent` provenance in the transcript and final record.

## Install

```sh
npx skills add https://github.com/1arley/grill-with-jev --skill grill-with-jev
```

The repository keeps the skill at `skills/productivity/grill-with-jev`. Install its pinned runtime dependencies once in the installed skill directory (the directory containing `SKILL.md`):

```sh
npm ci --ignore-scripts --prefix "$SKILL_DIR"
```

Node.js 22 or newer is required. There are no install hooks. This skill has `disable-model-invocation: true`; invoke it explicitly because calls can spend API credits.

## Setup JEV

The user chooses the provider. Set `JEV_PROVIDER` when more than one provider key is available; otherwise the first detected key in the documented provider order is selected. The four JEV integrations have the supplied default model IDs below; `JEV_MODEL` or saved setup can override them. Configure current input/output rates and a session ceiling before paid requests.

| Provider | Key variable | Default model |
|---|---|---|
| TypeSafe (official) | `TYPESAFE_API_KEY` | `jev-latest` |
| OpenRouter | `OPENROUTER_API_KEY` | `typesafe/jev-1.13` |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | `typesafe-ai/jev` |
| OpenCode Zen | `OPENCODE_API_KEY` | `jev-1.13-free` |

```sh
npm --prefix "$SKILL_DIR" exec -- tsx "$SKILL_DIR/scripts/setup.ts" --set-model openai <current-model-id> --approved
npm --prefix "$SKILL_DIR" exec -- tsx "$SKILL_DIR/scripts/setup.ts" --pricing --input-usd-per-million <rate> --output-usd-per-million <rate> --max-usd 0.50 --approved
```

The provider and model can instead be set for one process with `JEV_PROVIDER`, `JEV_MODEL`, `JEV_API_KEY`, and `JEV_BASE_URL`. To allow dotenv key discovery, ask the user once and record their choice:

```sh
npm --prefix "$SKILL_DIR" exec -- tsx "$SKILL_DIR/scripts/setup.ts" --consent-dotenv --approved
```

This enables lookup in `~/.jev-gateway/.env` and the project/Git-root `.env`, `.env.local`, and `.env.development` files. Existing configs that previously consented only to project dotenv need one additional gateway-file approval via `--consent-gateway-dotenv --approved`; the old choice never authorizes reading it. To decline all dotenv lookup, use `--deny-dotenv --approved`. For a stored key, use `setup.ts --set-key <provider> --approved`; it reads the key without echo and writes it to `~/.config/jev/config.json` with owner-only permissions. Do not pass keys as command arguments.

To create a profile, first ask which source files the user authorizes. Collect only those approved paths with `setup.ts --collect-sources AGENTS.md CLAUDE.md GLOSSARY.md CONTEXT.md README.md docs/adr/...`; add `--git-log` only when authorized. Draft a concise profile from the returned content, show it to the user, and save only after approval:

```sh
npm --prefix "$SKILL_DIR" exec -- tsx "$SKILL_DIR/scripts/setup.ts" --save-profile repo --approved
```

Pipe the approved Markdown draft to that command. Choose `global` instead of `repo` to save `~/.config/jev/profile.md`. `.jev/` is ignored by Git to avoid publishing personal preferences.

## How credentials are found

Resolution order is explicit `JEV_*` settings, allowlisted process environment keys, consented dotenv files, `~/.config/jev/config.json`, then an exact secret-manager argv configured by the user. With multiple keys, `JEV_PROVIDER` wins; otherwise the provider order is TypeSafe, OpenRouter, Vercel AI Gateway, OpenCode Zen, Anthropic, OpenAI, Gemini, Mistral, Groq, xAI, DeepSeek, Together, Fireworks, Azure. Local Ollama and LM Studio need no key.

The process environment checks `JEV_PROVIDER`, `JEV_API_KEY`, `JEV_MODEL`, `JEV_BASE_URL`, and only these provider names: `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, `AI_GATEWAY_API_KEY`, `OPENCODE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_API_KEY`, `MISTRAL_API_KEY`, `GROQ_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, `TOGETHER_API_KEY`, `FIREWORKS_API_KEY`, and `AZURE_OPENAI_API_KEY` with `AZURE_OPENAI_ENDPOINT`. Dotenv parsing uses the same `JEV_*` overrides and provider key names, but not `AZURE_OPENAI_ENDPOINT`; that endpoint is read only from process environment or saved config.

Before the first dotenv lookup, ask the user once and record their choice with `setup.ts --consent-dotenv --approved` (or `--deny-dotenv`). This new choice covers both the gateway and project dotenv paths. An older project-only approval does not authorize `~/.jev-gateway/.env`; ask once more and use `--consent-gateway-dotenv --approved` if needed. Only `~/.jev-gateway/.env` and `.env`, `.env.local`, and `.env.development` at the working project and Git roots are parsed; the files are never sourced. A secret-manager command must be entered explicitly and separately approved before its first run. The agent sees only provider, source, variable name, and the last four key characters. Requests use the provider's allowlisted HTTPS host; remote custom endpoints require an exact stored confirmation. TypeSafe and OpenCode Zen use the direct System One route (`POST <base URL>/systemone`) through a user-confirmed endpoint. A confirmed local System One gateway may use plain HTTP on loopback hosts only (`localhost`, `127.0.0.1`, `::1`); the advisor gateway that stores credentials in `~/.jev-gateway/.env` is the intended example. Ollama/LM Studio are likewise limited to loopback hosts. See [Security](skills/productivity/grill-with-jev/references/security.md) and [Providers](skills/productivity/grill-with-jev/references/providers.md).

## Cost, limits, and privacy

Every paid request requires configured input/output rates and a maximum session spend. `--dry-run` reports a conservative prompt-token/cost estimate; each retry reserves its own token and cost budget before sending. Returned provider usage replaces estimates when available. The default session token ceiling is 20,000 and the round ceiling is 8. Prices can change; update the saved rate card from the provider's current pricing page before using a different model. `--mock` is deterministic and offline.

The skill never scans the disk, reads OAuth/session tokens from other tools, sources dotenv files, prints keys, or logs provider error bodies. It sends the approved JEV profile, relevant allowlisted Markdown context, and round transcript to the selected provider; never include secrets or `.env` content in those sources. It has no postinstall, analytics, obfuscated code, or non-provider runtime network access. Audit lines are written to `.grill/<session>.jsonl`; `.grill/` and `.jev/` are Git-ignored.

To disable use, stop invoking the skill, remove it with your agent's skill manager, clear any saved API key from `~/.config/jev/config.json`, and set `dotenvConsent` / `secretManagerConsent` to `false` if you had enabled them. Removing the key does not revoke it at the provider; revoke it there if needed.

## Development

```sh
npm ci --ignore-scripts --prefix skills/productivity/grill-with-jev
npm run --prefix skills/productivity/grill-with-jev typecheck
npm test --prefix skills/productivity/grill-with-jev
npm run --prefix skills/productivity/grill-with-jev eval:mock
npm run --prefix skills/productivity/grill-with-jev eval:canary
npm run --prefix skills/productivity/grill-with-jev eval:budget
```

CI runs typecheck, unit/eval tests, a local OpenAI-compatible canary server, and Gitleaks. No real provider request is needed for CI.

## License and attribution

The skill adapts Matt Pocock's `grilling` workflow and preserves its MIT license and attribution. See [LICENSE](LICENSE).

## pt-BR

`grill-with-jev` adapta a skill `grilling`, de Matt Pocock (MIT). O agente calcula a fronteira de decisões e mostra cada rodada no formato original `❓`/`➡️`; o JEV responde por contrato Zod validado e nunca pesquisa fatos. Somente perguntas escaladas aguardam resposta humana. Quando a fronteira esvazia, o agente escreve `decision-record.md` e pede uma confirmação final antes de agir, exceto quando a invocação traz `--autonomous`.

Instale com `npx skills add https://github.com/1arley/grill-with-jev --skill grill-with-jev`. Node.js 22+ é necessário. Instale as dependências fixadas no diretório da skill com `npm ci --ignore-scripts --prefix "$SKILL_DIR"`.

O usuário escolhe o provedor. Para as quatro integrações JEV, os modelos padrão são: TypeSafe (`jev-latest`), OpenRouter (`typesafe/jev-1.13`), Vercel AI Gateway (`typesafe-ai/jev`) e OpenCode Zen (`jev-1.13-free`); `JEV_MODEL` pode sobrescrevê-los. Configure preços atuais e teto via `scripts/setup.ts` antes de chamadas pagas; os limites padrão são 20 mil tokens e 8 rodadas. `--dry-run` estima sem chamar o provedor; `--mock` funciona offline.

Chaves são descobertas somente nas variáveis listadas acima, em `~/.jev-gateway/.env` ou nos três arquivos dotenv do projeto após um consentimento único, no arquivo `~/.config/jev/config.json` ou em um comando exato de gerenciador de segredos que o usuário configurou e autorizou. TypeSafe e OpenCode Zen usam a rota direta System One (`POST <base URL>/systemone`) por um endpoint confirmado pelo usuário; gateway local System One confirmado pode usar HTTP puro apenas em hosts loopback (`localhost`, `127.0.0.1`, `::1`) — o gateway advisor que guarda credenciais em `~/.jev-gateway/.env` é o exemplo previsto. Não presumimos outros hosts. A chave nunca aparece no transcript, nos logs ou na saída; apenas provedor, origem, variável e últimos quatro caracteres. O código não varre disco, não lê tokens de sessão/OAuth de outras ferramentas e só envia requisições ao host permitido/confirmado do provedor. O perfil pessoal não é versionado (`.jev/` está no `.gitignore`).

Para desligar, pare de invocar a skill, remova-a pelo gerenciador do agente e apague a chave salva. Revogue a chave também no provedor quando necessário.
