# Antigravity CLI — Companion Plugin per Claude Code

Questo plugin consente di integrare e utilizzare le funzionalità di Google Antigravity (`agy`) direttamente dall'interno di Claude Code.

## Funzionalità principali

- **/agy:setup**: Esegue la diagnostica dello stato di installazione e configurazione di Antigravity, inclusa la validazione del Personal Access Token (PAT) di GitHub Marketplace.
- **/agy:model**: Consente di scegliere in modo interattivo o diretto il modello da utilizzare (es. `gemini-3.5-flash`).
- **/agy:marketplace-add**: Abilita e configura l'installazione via GitHub Marketplace configurando in modo sicuro un Personal Access Token (PAT) e il relativo repository.
- **/agy:review**: Esegue una code review automatica del codice corrente.
- **/agy:adversarial-review**: Avvia una review mirata focalizzata sull'analisi di rischi e difetti.
- **/agy:rescue**: Delega un task specifico ad Antigravity in background o foreground.

---

## Configurazione e Installazione via GitHub Marketplace

Per utilizzare le installazioni protette da GitHub Marketplace (es. per repository privati o sorgenti riservati), è necessario abilitare l'integrazione fornendo un Personal Access Token (PAT) di GitHub.

### Comando di Configurazione

Esegui il comando:

```bash
/agy:marketplace-add [pat] [repository-o-url]
```

Se non vengono forniti gli argomenti, il comando richiederà in modo interattivo e mascherato l'inserimento delle credenziali.

### Permessi Richiesti per il PAT di GitHub

Per garantire la corretta installazione dei sorgenti e dei package, il token PAT configurato deve disporre dei seguenti scope a seconda dell'uso:

1. **`repo`** (Full control of private repositories)
   - *Quando serve*: Obbligatorio se il repository di riferimento è privato. Consente alla CLI di effettuare la clonazione, leggere i sorgenti e accedere al codice privato del workspace.
2. **`read:packages`** (Download packages from GitHub Packages)
   - *Quando serve*: Necessario per autenticare il download di pacchetti privati o protetti pubblicati sul registro dei pacchetti di GitHub (GitHub Packages).
3. **`contents:read`** (Permesso Fine-grained)
   - *Quando serve*: Se utilizzi i nuovi token GitHub *Fine-grained*, abilita questo permesso a livello di repository (`Repository permissions -> Contents: Read-only`) per consentire la sola lettura del codice sorgente senza concedere privilegi di scrittura.
