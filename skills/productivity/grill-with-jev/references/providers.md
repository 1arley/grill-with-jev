# Providers and model setup

`JEV_PROVIDER`, `JEV_API_KEY`, `JEV_MODEL`, and `JEV_BASE_URL` are explicit overrides. Without an explicit provider, keys are checked in this order: TypeSafe, OpenRouter, Vercel AI Gateway, OpenCode Zen, Anthropic, OpenAI, Gemini, Mistral, Groq, xAI, DeepSeek, Together, Fireworks, Azure. A local provider is selected only with `JEV_PROVIDER=ollama` or `JEV_PROVIDER=lm-studio`.

| Provider | Process/dotenv key names | Default model | Destination host |
|---|---|---|---|
| TypeSafe (official) | `TYPESAFE_API_KEY` | `jev-latest` | User-confirmed HTTPS endpoint; no direct API host is documented here |
| OpenRouter | `OPENROUTER_API_KEY` | `typesafe/jev-1.13` | `openrouter.ai` |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | `typesafe-ai/jev` | `ai-gateway.vercel.sh` |
| OpenCode Zen | `OPENCODE_API_KEY` | `jev-1.13-free` | User-confirmed HTTPS endpoint; no direct API host is documented here |
| Anthropic | `ANTHROPIC_API_KEY` | — | `api.anthropic.com` |
| OpenAI | `OPENAI_API_KEY` | — | `api.openai.com` |
| Gemini | `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_API_KEY` | — | `generativelanguage.googleapis.com` |
| Mistral | `MISTRAL_API_KEY` | — | `api.mistral.ai` |
| Groq | `GROQ_API_KEY` | — | `api.groq.com` |
| xAI | `XAI_API_KEY` | — | `api.x.ai` |
| DeepSeek | `DEEPSEEK_API_KEY` | — | `api.deepseek.com` |
| Together | `TOGETHER_API_KEY` | — | `api.together.xyz` |
| Fireworks | `FIREWORKS_API_KEY` | — | `api.fireworks.ai` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` plus `AZURE_OPENAI_ENDPOINT` | — | the configured `*.openai.azure.com` resource |

The Node process environment is checked without prompting. A new `--consent-dotenv` choice covers `~/.jev-gateway/.env` and `.env`, `.env.local`, and `.env.development` in the working project root and Git root. Existing configs with only `dotenvConsent` set do not implicitly authorize the gateway path; ask once and save `gatewayDotenvConsent` with `setup.ts --consent-gateway-dotenv --approved`. Files are parsed as text; only the allowlisted key variables and `JEV_*` overrides are retained. `~/.config/jev/config.json` is checked after dotenv. Keychain/1Password/pass/Doppler/Infisical commands run only when the user has stored an exact argv in that config and separately consented to running it. The optional AWS Bedrock credential chain is not enabled.

The provider packages use their documented first-party APIs for Anthropic, Gemini, and AI Gateway; the other remote providers use the AI SDK OpenAI-compatible adapter. See the [AI SDK structured output API](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data), [provider documentation](https://ai-sdk.dev/providers/ai-sdk-providers), and [OpenAI-compatible provider guide](https://ai-sdk.dev/providers/openai-compatible-providers).

The four JEV model defaults in the table were supplied for this skill and can be overridden with `JEV_MODEL` or saved setup. Other providers require a configured model. OpenCode Zen requires the user to confirm an HTTPS base URL with `setup.ts --confirm-base-url <url> --provider <provider> --approved`; its direct API protocol is not documented here, so the adapter assumes OpenAI-compatible chat completions with structured output. Do not guess an endpoint. TypeSafe also requires a confirmed base URL, but its official API is System One (`POST /v1/systemone`), not chat completions, so `ask-jev.ts` calls it directly: each round question becomes a `choice` question with `aceitar`/`ajustar`/`escalar` criteria, and the returned probabilities become the answer's `rationale` and `assumptions`. System One has no text channel, so it cannot produce a prose rationale; switch providers if prose matters. Model names come from `GET /v1/models` on the confirmed host, and an alias from a dotenv file (`JEV_MODEL`) overrides the saved setup model, so a stale alias fails with `provider-error` instead of falling back. Configure input/output USD per million tokens and the maximum session cost in setup; without rates it refuses paid requests. The default session token ceiling is 20,000 and maximum round count is 8; both are configurable.

The current SDK documentation describes Node.js 18+ for its quickstart, while the installed AI SDK/provider packages declare Node.js 22+. This skill therefore requires Node.js 22 or newer. It uses Anthropic cache-control metadata for the repeated profile/context prefix when that provider is selected; other providers use their documented/default caching behavior.
