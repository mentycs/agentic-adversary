---
description: Consente all'utente di scegliere in modo interattivo o diretto un modello tra quelli disponibili in agy
argument-hint: '[nome-modello]'
allowed-tools: AskUserQuestion, Bash(node:*)
---

Esegui:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" model "$ARGUMENTS"
```

Se il comando richiede una selezione interattiva:
- Usa `AskUserQuestion` per presentare le opzioni all'utente.
- Invia il modello selezionato nuovamente al comando per impostarlo.
