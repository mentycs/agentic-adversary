# Changelog — Codex Aversary

> Unified tracking of every project change.
> "Releases" lists all tagged versions, newest first.
> "Action log" lists every atomic action, newest first. Entries are IMMUTABLE — corrections must be appended as new actions.

## Releases

### [0.3.4] — 2026-05-28
- Spostata la configurazione del modello di default direttamente all'interno delle impostazioni predefinite dello stato (`defaultState()` in `state.mjs`).
- Reso `gemini-3.5-flash` il modello di default forzatamente pre-impostato per tutte le nuove sessioni, a meno che non venga modificato manualmente con `/agy:model`.
- Mantenuti tutti i controlli di integrità ed esagonali di `SetupUseCase` e `ModelUseCase` allineati alla nuova configurazione predefinita.

### [0.3.3] — 2026-05-28
- Rimossa del tutto l'obbligatorietà e la segnalazione d'errore relativa a `GEMINI_API_KEY`, delegando l'autenticazione all'esito effettivo della CLI `agy` (OAuth).
- Implementati gli adapter reali Node.js per le porte esagonali (`NodeShellAdapter`, `NodeFileSystemAdapter`, `NodeStateAdapter`, `NodeInteractionAdapter`) in `plugins/agy/scripts/lib/adapters.mjs`.
- Cablato `SetupUseCase` nel setup locale di `agy-companion.mjs` per unificare i flussi di controllo architetturali.
- Cablato `ModelUseCase` nel nuovo subcommand `model` di `agy-companion.mjs` per supportare l'impostazione diretta e interattiva del modello `/agy:model`.
- Introdotta l'autoconfigurazione automatica al modello predefinito `gemini-3.5-flash` in assenza di selezioni passate, e gestito il fallback statico sui modelli Gemini noti qualora la CLI non risponda.
- Suite di test aggiornata e superata con successo (24 test passati).

### [0.3.2] — 2026-05-28
- Implementato `ModelUseCase` in `src/core/model-use-case.mjs` per gestire la selezione del modello in modo diretto e interattivo.
- Aggiornato `SetupUseCase` in `src/core/setup-use-case.mjs` per includere la validazione del modello precedentemente selezionato e il fallback a `--help` se `agy model` fallisce.
- Passati con successo tutti i 15 test TDD nativi in `tests/model-use-case.test.mjs` e `tests/setup-use-case.test.mjs`.

### [0.3.1] — 2026-05-28
- Eseguita la validazione e la verifica finale del plugin `plugins/agy/` (GREEN LIGHT).
- Aggiornato il report di validazione avversaria (`report-2026-05-28-adversary-validation-agy.md`) per documentare il superamento di tutti i controlli.

### [0.3.0] — 2026-05-28
- Migrazione completa dei comandi del plugin e implementazione dello script companion `agy-companion.mjs` usando il wrapping diretto della CLI `agy` (Approccio A).
- Corretto il routing dei comandi Markdown in `plugins/agy/commands/` per passare attraverso lo script companion e quotare correttamente `$ARGUMENTS` in tutte le chiamate.
- Rimosso interamente il codice obsoleto relativo all'app-server di OpenAI Codex e al daemon del broker.
- Aggiunto il supporto e la compatibilità per Windows tramite l'opzione `shell: true` rilevando la sessione Git Bash.
- Aggiunta una suite completa di test in `tests/agy-companion.test.mjs` per validare i comandi di setup, review, adversarial-review, task, status, result e cancel.

### [0.2.3] — 2026-05-28
- Rimozione del controllo sulla libreria Python `google-antigravity` e sulla chiave d'ambiente `GEMINI_API_KEY` in quanto non più necessari (autenticazione gestita tramite OAuth nella CLI).
- Semplificazione del costruttore di `SetupUseCase` con la rimozione della porta `envPort`.
- Pulizia e aggiornamento della suite di test in `tests/setup-use-case.test.mjs`.

### [0.2.2] — 2026-05-28
- Implementazione definitiva dei controlli di autenticazione (`_checkGeminiApiKey`) e quota (`_checkQuota`) nel caso d'uso `SetupUseCase`.
- Aggiunta della logica per discriminare tra errori di autenticazione/login fallito ed errori di limiti di quota raggiunti (codici 401 e 429).
- Scrittura di nuovi casi di test TDD per validare la robustezza del parsing degli errori in `tests/setup-use-case.test.mjs`.

### [0.2.1] — 2026-05-28
- Copia della struttura originale del plugin in `plugins/agy` e aggiornamento dei comandi per eseguire `agy` (Approccio A).
- Aggiunta di test TDD fallimentari per autenticazione tramite sessione attiva e monitoraggio quota.
- Aggiornamento del caso d'uso `SetupUseCase` con la bozza dei nuovi controlli.

### [0.2.0] — 2026-05-28
- Implementazione del caso d'uso `SetupUseCase` per il comando `/agy:setup` in architettura esagonale, con controlli eseguiti in parallelo e gestione sicura delle eccezioni.
- Risoluzione con successo di tutti i test della suite TDD nativa di Node.js.

### [0.1.3] — 2026-05-28
- Aggiunta della cartella temporanea `codex-plugin-cc` al file `.gitignore`.

### [0.1.2] — 2026-05-28
- Integrare l'elenco dei bug noti e delle relative soluzioni provenienti dai 10 branch del repository original nel documento di analisi di compatibilità.

### [0.1.1] — 2026-05-28
- Completamento dell'analisi comparativa dettagliata tra OpenAI Codex e Google Antigravity (`agy`), con relativa matrice di compatibilità per la migrazione del plugin.

### [0.1.0] — 2026-05-28
- Inizializzazione della struttura del repository e avvio dell'analisi comparativa tra OpenAI Codex Plugin CC e Antigravity SDK (`agy`).

## Action log

- **2026-05-28 10:55**: Spostato il modello predefinito globale all'interno di `defaultState()` di `state.mjs`. In questo modo `gemini-3.5-flash` viene configurato automaticamente all'avvio come modello predefinito, a meno che non venga modificato manualmente.
  - **Rationale**: Assicurare che tutti i comandi legati ad agy utilizzino fin da subito gemini-3.5-flash senza forzature a runtime durante il setup.
  - **User request**: mdifica l'impostazione di default forzata in /agy:model gemini-3.5-flash , a meno che non sia stata modificata manualmente con /agy:setup.
  - **Rollback**: Ripristinare `plugins/agy/scripts/lib/state.mjs` e `VERSION` allo stato precedente all'azione (rilascio `0.3.3`).

- **2026-05-28 10:35**: Decoppiata definitivamente la chiave API `GEMINI_API_KEY` da setup e test. Implementati gli adapter reali delle porte esagonali e cablati `SetupUseCase` e `ModelUseCase` nel companion script, completando il comando `/agy:model`.
  - **Rationale**: Permettere un setup robusto basato solo su OAuth CLI e autoconfigurare `gemini-3.5-flash` in modo resiliente rispetto ai limiti di interrogazione di agy.
  - **User request**: La mancanza della variabile GEMINI_API_KEY non è bloccante, rimuovi quei vincoli. Predisponi una opzione per il setting del modello /agy:model che dopo invio entra nella modalità interattiva.
  - **Rollback**: Ripristinare `plugins/agy/scripts/agy-companion.mjs`, `tests/agy-companion.test.mjs` e `VERSION` allo stato precedente all'azione (rilascio `0.3.2`).

- **2026-05-28 09:40**: Implementati ed eseguiti con successo i test TDD per il comando `/agy:model` e l'integrazione della validazione del modello in `/agy:setup`.
  - **Rationale**: Soddisfare i requisiti del Room Adversary per l'architettura esagonale disaccoppiando la business logic tramite StatePort e InteractionPort e integrando controlli robusti nel setup.
  - **User request**: Review the hexagonal architecture design and TDD test suite proposed for the new `/agy:model` command and the updated `/agy:setup` model validation checks.
  - **Rollback**: Ripristinare `src/core/model-use-case.mjs`, `src/core/setup-use-case.mjs` e `VERSION` alle versioni precedenti.

- **2026-05-28 08:35**: Eseguita validazione finale del plugin Antigravity (`plugins/agy/`) con esito positivo (GREEN LIGHT).
  - **Rationale**: Confermare la completa eliminazione di qualsiasi riferimento a Codex, la corretta ridenominazione dei subagent/skill e il superamento dei test del plugin.
  - **User request**: Perform the final verification of the Antigravity plugin in `plugins/agy/` after the complete decoupling and renaming process.
  - **Rollback**: Ripristinare il report `report-2026-05-28-adversary-validation-agy.md` e questo file alla versione precedente.

- **2026-05-28 07:55**: Rinominati subagent e skill di Antigravity, rimossi residui legacy di Codex e localizzati i messaggi d'errore.
  - **Rationale**: Risolvere la seconda RED LIGHT del Room Adversary eliminando le tracce legacy di Codex non rimosse e rinominando subagent e skill ad `agy-rescue` e `agy-cli-runtime` / `agy-result-handling` per garantire la corretta registrazione del plugin. Localizzati in italiano tutti i messaggi d'errore hardcoded e i log in `job-control.mjs` e `render.mjs`.
  - **User request**: RED LIGHT (Validation Failed) due to legacy OpenAI Codex leftovers and broken integrations...
  - **Rollback**: Ripristinare `plugins/agy/agents/agy-rescue.md` a `codex-rescue.md`, ripristinare le directory delle skill a `codex-*`, e ripristinare `job-control.mjs`, `render.mjs` e `fs.mjs` allo stato dell'azione precedente (07:45).

- **2026-05-28 07:45**: Migrazione completa e implementazione dei comandi e dello script companion `agy-companion.mjs` per Antigravity.
  - **Rationale**: Completare la migrazione ad Antigravity adattando la logica da codex a agy, risolvendo i feedback dell'adversary (red light) sul routing dei comandi e quotando gli argomenti per evitare word-splitting. Rimosse le dipendenze residue da codex e stabilizzato il tracciamento dei processi background.
  - **User request**: Migrate and implement the full plugin commands and companion script for the new Antigravity plugin using Approach A (Direct CLI wrapping)...
  - **Rollback**: Rimuovere `plugins/agy/scripts/agy-companion.mjs` e `tests/agy-companion.test.mjs`, ripristinare i file in `plugins/agy/commands/` e `plugins/agy/scripts/` all'ultimo commit e ripristinare il file `VERSION` a `0.2.3`.

- **2026-05-28 07:30**: Rimozione dei controlli obsoleti di libreria Python e chiave API e della porta `envPort` dal caso d'uso `SetupUseCase`.
  - **Rationale**: Poiché l'autenticazione è delegata a OAuth, i controlli di `GEMINI_API_KEY` e della libreria python `google-antigravity` sono ridondanti e rischiano di generare falsi negativi durante il setup.
  - **User request**: Remove the `google-antigravity` Python library check and the `GEMINI_API_KEY` check from the plugin, as they are no longer required (authentication is handled purely via OAuth in the CLI)...
  - **Rollback**: Ripristinare `src/core/setup-use-case.mjs` e `tests/setup-use-case.test.mjs` allo stato del rilascio `0.2.2` (azione `07:20`) e ripristinare il file `VERSION` a `0.2.2`.

- **2026-05-28 07:20**: Implementazione finale e convalida del design del caso d'uso `SetupUseCase` e scrittura dei relativi test di integrità per la gestione degli errori.
  - **Rationale**: Completare l'implementazione dei controlli di setup gestendo in modo accurato la decodifica dei messaggi di errore del comando `agy quota` e garantendo la corretta conformità architetturale.
  - **User request**: Convalida dell'architettura esagonale e del design TDD per il comando `/agy:setup` gestendo la differenziazione degli errori tra fallimento del login e raggiungimento dei limiti di quota.
  - **Rollback**: Ripristinare il file `src/core/setup-use-case.mjs` e `tests/setup-use-case.test.mjs` allo stato dell'azione `07:15` e ripristinare il file `VERSION` a `0.2.1`.

- **2026-05-28 07:15**: Copia del plugin in `plugins/agy`, aggiornamento dei comandi per l'Approccio A, scrittura dei test fallimentari TDD e aggiornamento del template di SetupUseCase.
  - **Rationale**: Predisporre la struttura per supportare i nuovi requisiti di autenticazione con login/password e il monitoraggio dei limiti di quota sul comando `/agy:setup`.
  - **User request**: Design the updates for the first vertical slice (/agy:setup) based on the new requirements: 1. Authentication must use login/password (no API-Key required if login session is active)...
  - **Rollback**: Rimuovere la directory `plugins/agy` e ripristinare `src/core/setup-use-case.mjs` e `tests/setup-use-case.test.mjs` all'azione precedente.

- **2026-05-28 07:05**: Implementazione finale del caso d'uso `SetupUseCase` in `src/core/setup-use-case.mjs` e verifica positiva tramite test suite.
  - **Rationale**: Completare la logica del comando `/agy:setup` integrando l'esecuzione concorrente e l'exception safety, portando al superamento di tutti i test.
  - **User request**: Implement `src/core/setup-use-case.mjs` to pass the tests in `tests/setup-use-case.test.mjs`.
  - **Rollback**: Ripristinare lo scheletro minimale del caso d'uso in `src/core/setup-use-case.mjs`.

- **2026-05-28 07:00**: Creazione dei file delle porte (ShellPort, FileSystemPort, EnvPort), dello scheletro del caso d'uso SetupUseCase e della suite di test TDD nativa.
  - **Rationale**: Impostare l'architettura esagonale per la prima slice verticale del plugin Antigravity (/agy:setup) scrivendo prima i test per guidare lo sviluppo (TDD).
  - **User request**: Design the hexagonal architecture structure and write a TDD test suite for the first vertical slice of the new Antigravity plugin: the `/agy:setup` command.
  - **Rollback**: Rimuovere le directory `src` e `tests` e ripristinare il file `package.json`.

- **2026-05-28 06:55**: Aggiunta di `codex-plugin-cc/` a `.gitignore`.
  - **Rationale**: Prevenire il tracciamento git del repository clone temporaneo utilizzato per scopi analitici all'interno del workspace.
  - **User request**: Aggiungi a .gitignore codex-plugin-cc.
  - **Rollback**: Rimuovere `codex-plugin-cc/` dal file `.gitignore`.

- **2026-05-28 06:50**: Aggiunta della sezione "Problematiche Risolte nei Branch e Release di Codex" nel file `analysis-2026-05-28-codex-to-agy-compatibility-matrix.md`.
  - **Rationale**: Documentare i problemi riscontrati nel ciclo di sviluppo del plugin originario per impedire la reintroduzione di bug simili (ad es. ricorsione delle skill, problemi con il path del terminale Windows, overflow del buffer diff, o interazione con sessioni parallele).
  - **User request**: Elenca tutte le problematiche segnalate e risolte nei 10 branch e inseriscile nel documento che hai prodotto.
  - **Rollback**: Rimuovere la sezione modificata dal file `analysis-2026-05-28-codex-to-agy-compatibility-matrix.md`.

- **2026-05-28 06:45**: Scrittura e salvataggio dello studio comparativo e della matrice di compatibilità nel file `analysis-2026-05-28-codex-to-agy-compatibility-matrix.md`.
  - **Rationale**: Fornire al team una guida strutturata per la migrazione del codice del plugin, valutando le differenze architetturali e definendo i passi operativi.
  - **User request**: Fare uno studio dettagliato e approfondito delle differenze tra codex e agy e creare una matrice di compatibilità per il passaggio del codice per sostituire agy a codex in formato md.
  - **Rollback**: Rimuovere il file `analysis-2026-05-28-codex-to-agy-compatibility-matrix.md`.

- **2026-05-28 06:30**: Configurazione iniziale del progetto (creazione di `.gitignore`, `VERSION`, `CHANGELOG.md`).
  - **Rationale**: Garantire la conformità con le regole globali del progetto relative al tracciamento dei cambiamenti.
  - **User request**: Iniziare il nuovo progetto, fare uno studio approfondito tra codex e agy e creare una matrice di compatibilità salvata in formato md.
  - **Rollback**: Rimuovere `.gitignore`, `VERSION`, e `CHANGELOG.md`.
