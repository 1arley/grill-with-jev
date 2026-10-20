# Providers and model setup

`JEV_PROVIDER`, `JEV_API_KEY`, `JEV_MODEL`, and `JEV_BASE_URL` are explicit overrides. Without an explicit provider, keys are checked in this order: TypeSafe, OpenRouter, Vercel AI Gateway, OpenCode Zen, Anthropic, OpenAI, Gemini, Mistral, Groq, xAI, DeepSeek, Together, Fireworks, Azure. A local provider is selected only with `JEV_PROVIDER=ollama` or `JEV_PROVIDER=lm-studio`.

| Provider | Process/dotenv key names | Default model | Destination host |
|---|---|---|---|
| TypeSafe (official) | `TYPESAFE_API_KEY` | `jev-latest` | User-confirmed base URL; remote must be HTTPS, confirmed loopback HTTP allowed for a local System One gateway |
| OpenRouter | `OPENROUTER_API_KEY` | `typesafe/jev-1.13` | `openrouter.ai` |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | `typesafe-ai/jev` | `ai-gateway.vercel.sh` |
| OpenCode Zen | `OPENCODE_API_KEY` | `jev-1.13-free` | User-confirmed base URL; remote must be HTTPS, confirmed loopback HTTP allowed for a local System One gateway |
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

The four JEV model defaults in the table were supplied for this skill and can be overridden with `JEV_MODEL` or saved setup. Other providers require a configured model. OpenCode Zen and TypeSafe use the direct System One route: `POST <confirmed base URL>/systemone` — OpenCode Zen's chat-completions adapter cannot express System One choice questions. A local gateway that serves System One (for example the advisor gateway that keeps credentials in `~/.jev-gateway/.env` and answers on `http://localhost:20128/v1/systemone`) is confirmed with `setup.ts --confirm-base-url http://localhost:20128/v1 --provider opencode-zen --approved`; plain HTTP is only ever accepted on loopback hosts (`localhost`, `127.0.0.1`, `::1`) after that exact confirmation. The gateway's provider name `opencode` is accepted as an alias for `opencode-zen`, so `JEV_PROVIDER=opencode` in the gateway dotenv file resolves out of the box once `gatewayDotenvConsent` is saved; add `JEV_BASE_URL=http://localhost:20128/v1` to that dotenv file (or confirm it in config) and the round goes out with the same `OPENCODE_API_KEY` the gateway already stores. Configure input/output USD per million tokens and the maximum session cost in setup; without rates it refuses paid requests. The default session token ceiling is 20,000 and maximum round count is 8; both are configurable.

The current SDK documentation describes Node.js 18+ for its quickstart, while the installed AI SDK/provider packages declare Node.js 22+. Consequently it requires Node.js 22 or newer. It uses Anthropic cache-control metadata for the repeated profile/context prefix when that provider is selected; other providers use their documented/default caching behavior.

Confidence thresholds must match the provider channel. System One answers as probabilities: on real decision questions the top choice usually lands between 0.2 and 0.5, so the generic 0.6 escalation threshold escalates nearly every answer. For System One providers (TypeSafe, OpenCode Zen) the default threshold is 0.35; text providers keep 0.6. `JEV_CONFIDENCE_THRESHOLD` or `config.confidenceThreshold` overrides either.
