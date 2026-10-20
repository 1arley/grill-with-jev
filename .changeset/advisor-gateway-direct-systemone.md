---
"#grill-with-jev": patch
---

Resolve o fluxo observado com o advisor gateway local do autor:

- `JEV_PROVIDER=opencode` (nome usado em `~/.jev-gateway/.env`) virou alias de `opencode-zen`, permitindo reutilizar as credenciais e o modelo do gateway sem renomear nada
- Endpoint local confirmado via setup agora aceita HTTP puro em hosts loopback (`localhost`, `127.0.0.1`, `::1`) — antes só ollama/lm-studio tinham essa permissão, e o gateway do autor (System One em `http://localhost:20128/v1/systemone`) travava no validation
- OpenCode Zen passa a usar o caminho System One (`POST /v1/systemone`) em vez do adapter chat-completions, que não representa perguntas de escolha
- Threshold de confiança ganha default 0.35 para providers System One (probabilidades calibradas costumam ficar 0.2–0.5; o default 0.6 escalava quase todo round)
- Providers.md e SKILL.md documentam o recipe do gateway local, a reclassificação de risco pelo host e o uso de session IDs novos por grill (probes gastam numero de round)
