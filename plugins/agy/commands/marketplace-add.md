---
description: Consente di abilitare e configurare l'installazione tramite GitHub Marketplace fornendo un Personal Access Token (PAT) e il nome/URL del repository GitHub.
argument-hint: '[pat] [repository-o-url]'
allowed-tools: AskUserQuestion, Bash(node:*)
---

Esegui:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" marketplace-add $ARGUMENTS
```

### Permessi richiesti per il Personal Access Token (PAT) di GitHub:
Per consentire il corretto funzionamento dell'integrazione e dell'installazione dal Marketplace, il PAT fornito deve disporre dei seguenti permessi (scope) a seconda del tipo di repository:
- **`repo`** (Completo): Necessario se il repository da cui installare è privato (permette la lettura dei sorgenti e la clonazione).
- **`read:packages`**: Necessario per scaricare pacchetti privati ospitati su GitHub Packages.
- **`contents:read`** (Permesso fine-grained): Se si utilizzano i nuovi *Fine-grained Personal Access Tokens*, assicurarsi che sia abilitato l'accesso in sola lettura ai contenuti del repository (`Repository permissions -> Contents: Read-only`).
