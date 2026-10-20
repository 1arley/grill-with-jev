#!/bin/sh
# Atualiza a skill instalada (~/.agents/skills/grill-with-jev) e restaura as
# dependências runtime. Rode da raiz do repo depois de um git pull.
set -e
SKILL_DIR="${SKILL_DIR:-$HOME/.agents/skills/grill-with-jev}"

npx skills add https://github.com/1arley/grill-with-jev --skill grill-with-jev
npm ci --ignore-scripts --prefix "$SKILL_DIR"

printf '{"round":1,"sessionId":"update-verify","questions":[{"questionId":"Q1","title":"Update verify","body":"A skill atualizada resolve provider e endpoint do config.","recommendation":"Sim.","dependsOn":[],"risks":[]}],"transcript":[],"contextFiles":[]}' \
  | npx tsx "$SKILL_DIR/scripts/ask-jev.ts" --dry-run
