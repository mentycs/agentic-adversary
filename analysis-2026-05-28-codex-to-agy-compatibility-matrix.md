# Analisi di Compatibilità e Migrazione: da OpenAI Codex a Google Antigravity (`agy`)

Questo documento fornisce uno studio approfondito per la migrazione del plugin per Claude Code (derivato da `codex-plugin-cc`) da OpenAI Codex alla nuova CLI e SDK **Google Antigravity (`agy`)**. L'obiettivo è sostituire interamente l'infrastruttura di runtime e modelli di OpenAI con l'ecosistema Antigravity di Google basato su Gemini.

---

## 1. Panoramica dei due Ecosistemi

Prima di procedere con la matrice di compatibilità, è essenziale comprendere le differenze strutturali tra i due runtime.

### OpenAI Codex / Codex Companion
* **Modelli di Riferimento**: GPT-4o, GPT-5.4-mini, Spark.
* **Architettura di Comunicazione**: Client-Server tramite `codex app-server`. La comunicazione avviene tramite JSON-RPC su standard input/output o tramite un socket Unix locale (broker).
* **Gestione dei Task**: Gestione nativa e asincrona dei task e dei thread. La CLI gestisce i job in background ed espone comandi per interrogarne lo stato (`status`), recuperare i risultati (`result`) o annullarli (`cancel`).
* **Configurazione**: Gestita tramite file `.codex/config.toml` (a livello utente o progetto).

### Google Antigravity (`agy` / SDK)
* **Modelli di Riferimento**: Gemini 3.5 Flash (default), Gemini 3.5 Pro.
* **Architettura di Comunicazione**: Orientata agli oggetti in Python tramite l'SDK `google-antigravity` (classi `Agent`, `Conversation`, `Connection`), o tramite CLI sincrona `agy` (`--print`, `--prompt-interactive`, `--continue`).
* **Gestione dei Task**: Basata sul ciclo a eventi e su sessioni persistenti (`--conversation <id>`). Non ha un demone asincrono centrale nella CLI per i job in background, ma delega il tracciamento dei processi all'applicazione host.
* **Estensibilità & Sicurezza**: Supporto dichiarativo per le policy di sicurezza (`LocalAgentConfig(policies=[...])`), supporto nativo per Model Context Protocol (MCP) e una suite avanzata di Hook di ciclo di vita (`pre_turn`, `post_turn`, `pre_tool_call_decide`, `post_tool_call`, ecc.).
* **Gestione Plugin**: La CLI `agy` possiede un gestore di plugin nativo che permette di importare, installare, convalidare ed abilitare plugin sviluppati per Gemini o Claude (es. `agy plugin import <sorgente>`).

---

## 2. Differenze Architetturali Dettagliate

> [!NOTE]
> La differenza principale risiede nel protocollo di comunicazione. Mentre Codex richiede un broker socket o un `app-server` attivo per scambiare messaggi JSON-RPC con Claude Code, `agy` è primariamente una CLI sincrona e un SDK Python.

### Protocollo di Comunicazione
* **Codex**: Utilizza una connessione persistente JSON-RPC. Consente a Claude Code di inviare prompt strutturati e ricevere in tempo reale eventi asincroni dettagliati (es. quando Codex avvia un comando shell o applica una modifica a un file).
* **Antigravity**:
  * *Via CLI (`agy`)*: Funziona in modalità sincrona a riga di comando (`--print` per prompt singoli, o `--prompt-interactive` per sessioni interattive).
  * *Via SDK Python (`google-antigravity`)*: Consente di instanziare un agente programmabile in Python, con il controllo completo del ciclo di vita tramite hook.

### Sicurezza e Sandbox
* **Codex**: La sicurezza è delegata alla configurazione locale dell'app-server.
* **Antigravity**: Offre una gestione granulare della sicurezza tramite le **Policy**. Di default, l'agente locale nega `run_command` (shell) a meno che non sia specificamente configurata un'approvazione interattiva (`ask_user`), e limita l'accesso ai file alla directory del workspace.

---

## 3. Matrice di Compatibilità dei Comandi Slash

Di seguito è riportata la matrice per mappare i comandi slash originari di `codex-plugin-cc` sui rispettivi equivalenti o sulle strategie di implementazione con `agy`:

| Comando Originale (`codex:*`) | Funzionalità | Equivalente in Antigravity (`agy:*` / SDK) | Strategia di Migrazione / Note |
| :--- | :--- | :--- | :--- |
| `/codex:setup` | Verifica installazione ed autenticazione della CLI. | `/agy:setup` | Rileva la presenza della CLI `agy` tramite `command -v agy` e verifica la presenza della variabile d'ambiente `GEMINI_API_KEY`. Se assente, rimanda a Google AI Studio per generare la chiave. |
| `/codex:review` | Code review dei cambiamenti pendenti o del branch corrente. | `/agy:review` | Invoca `agy --print "Esegui una code review delle modifiche correnti..."` passandogli il diff di git come contesto, oppure esegue un agente Python dedicato configurato con una skill di review. |
| `/codex:adversarial-review` | Code review approfondita incentrata su assunzioni e rischi. | `/agy:adversarial-review` | Simile a `/agy:review`, ma passa istruzioni strutturate (prompt di adversarial review) per forzare il modello a mettere in discussione le scelte architetturali, i race condition e la gestione degli errori. |
| `/codex:rescue` | Delega un compito specifico a un subagent in background. | `/agy:rescue` | Avvia un agente Antigravity specificando `--conversation <id>` (o una nuova sessione) passandogli il prompt del task. La capability `enable_subagents=True` dell'SDK gestisce la delega in modo nativo. |
| `/codex:status` | Visualizza lo stato dei job in esecuzione. | `/agy:status` | Traccia lo stato leggendo il file di stato locale gestito dal plugin compagno (es. `state.json`), monitorando i PID dei processi `agy` in esecuzione in background. |
| `/codex:result` | Mostra l'output finale di un task completato. | `/agy:result` | Legge il file di log o l'output salvato per lo specifico `conversationId` o `jobId` nella cartella di stato locale. |
| `/codex:cancel` | Interrompe un job in background. | `/agy:cancel` | Invia un segnale `SIGTERM` (o termina l'albero dei processi) al PID del processo `agy` registrato per quel determinato job nel file di stato locale. |

---

## 4. Matrice di Compatibilità del Codice Sorgente

Questa matrice mappa i moduli JavaScript del plugin originale `codex-plugin-cc` sulle modifiche necessarie per implementarli usando `agy`:

| File/Modulo Originale | Scopo | Impatto nella Migrazione | Soluzione Proposta per Antigravity |
| :--- | :--- | :--- | :--- |
| `codex-companion.mjs` | Script principale che gestisce la logica dei comandi slash CLI. | **Medio** | Sostituire le chiamate a `codex` e `app-server` con chiamate corrispondenti a `agy` CLI o con l'invocazione di uno script broker Python. |
| `app-server.mjs` | Gestisce l'avvio e la comunicazione JSON-RPC con `codex app-server`. | **Alto** | *Vedi sezione "Strategie di Integrazione".* Opzione consigliata: implementare un server broker Python `agy-companion-server.py` che converte JSON-RPC in chiamate SDK Antigravity. |
| `app-server-broker.mjs` | Gestisce la connessione Unix Socket persistente (broker). | **Alto** | Può essere eliminato se si usa l'invocazione CLI diretta o riscritto per comunicare con il broker Python di `agy`. |
| `state.mjs` | Salva lo stato dei job locali e le configurazioni. | **Basso** | Mantenere la logica di memorizzazione dei file JSON locali (`state.json`), adattando le chiavi per mappare i `conversationId` di Antigravity invece dei `threadId` di Codex. |
| `git.mjs` | Raccoglie modifiche, diff e file tracciati da Git. | **Nessuno** | Mantenere intatto. È agnostico rispetto al modello o al runtime LLM. |
| `stop-review-gate-hook.mjs` | Esegue una revisione automatica prima della chiusura della sessione. | **Medio** | Modificare l'invocazione interna del task di review: sostituire il comando `codex` con l'equivalente chiamata a `agy` o al broker Python di Antigravity. |
| `session-lifecycle-hook.mjs` | Gestisce avvio e arresto della sessione. | **Basso** | Adattare per terminare correttamente eventuali processi broker o agenti `agy` rimasti appesi. |

---

## 5. Strategie di Implementazione del Nuovo Plugin

Per creare il nuovo plugin che utilizza `agy`, si possono seguire due strade principali:

### Approccio A: Wrapping Diretto della CLI `agy` (Semplice ma Limitato)
In questo approccio, il plugin per Claude Code esegue la CLI `agy` como processo sincrono per ogni comando.

* **Funzionamento**:
  * `/agy:review` -> Esegue `agy --print "Esegui review" --add-dir <workspace>`
  * `/agy:rescue` -> Esegue in background `agy --conversation <id> --print "Risolvi bug"` deviando l'output su un file di log.
* **Pro**: Implementazione rapida, nessuna necessità di scrivere codice di rete o protocolli complessi.
* **Contro**: Mancanza di feedback in tempo reale (streaming dei pensieri, notifiche di strumenti eseguiti o file modificati). Claude Code vedrà solo il risultato finale al completamento del processo.

### Approccio B: Broker Server JSON-RPC basato su SDK Python (Consigliato)
In questo approccio, si realizza uno script Python di supporto (`agy-companion-server.py`) che agisce da ponte (broker) tra il protocollo JSON-RPC atteso da Claude Code e l'SDK `google-antigravity`.

```
+-----------------+   JSON-RPC   +----------------------------+   Python API   +-------------------------+
|   Claude Code   | <----------> |  agy-companion-server.py   | <------------> | google-antigravity SDK  |
|  (Node.js Comp) | (Stdio/IPC)  | (Ascolta le richieste RPC) |                | (Agent, Conversation)   |
+-----------------+              +----------------------------+                +-------------------------+
```

* **Funzionamento**:
  * Lo script Python implementa gli hook dell'SDK (`pre_tool_call_decide`, `post_tool_call`, `post_turn`).
  * Ogni volta che l'agente esegue un tool o produce un token, lo script emette sulla porta standard/IPC una riga in formato JSON-RPC corrispondente alle notifiche previste dal plugin di Claude Code (es: `item/commandExecution`, `item/reasoning/textDelta`).
* **Pro**:
  * Compatibilità al 100% con il codice JavaScript del plugin esistente.
  * Preserva l'esperienza utente originale (streaming in tempo reale dei pensieri del modello, avanzamento visivo dei comandi eseguiti in background).
  * Consente di sfruttare al massimo la potenza e la flessibilità dell'SDK Python (policy di sicurezza declarative, configurazioni avanzate).
* **Contro**: Richiede lo sviluppo dello script ponte in Python.

## 6. Problematiche Risolte nei Branch e Release di Codex

Durante l'evoluzione del plugin originale `codex-plugin-cc`, sono state individuate e risolte diverse problematiche nei vari branch di sviluppo e nelle release ufficiali. Di seguito viene fornito l'elenco dettagliato di tali problemi con le relative risoluzioni. Queste informazioni sono cruciali per evitare di reintrodurre gli stessi bug durante lo sviluppo del nuovo plugin basato su `agy`:

### Branch di Sviluppo (`codex/*`)

* **`codex/plugin-auth-check`**
  * **Problema**: L'esecuzione di frequenti controlli di prontezza e autenticazione di Codex avviava ripetutamente nuove istanze di `app-server`, rallentando le prestazioni complessive e causando potenziali conflitti di porta.
  * **Soluzione**: Modificata la logica per riutilizzare l'istanza dell'app-server già attiva e interrogare direttamente lo stato di autenticazione dell'app-server stesso per determinare se Codex è pronto.
* **`codex/plugin-ci`**
  * **Problema**: Mancanza di una pipeline di integrazione continua per la compilazione automatica e l'esecuzione dei test. Inoltre, su sistemi Windows, l'esecuzione di script globali `npm` o `codex` tramite `spawnSync` generava errori a causa del mancato rilevamento degli shim `.cmd`.
  * **Soluzione**: Aggiunta la pipeline di GitHub Actions per le Pull Request e introdotta l'opzione `shell: true` nelle chiamate `spawnSync` su Windows.
* **`codex/plugin-eisdir-error`**
  * **Problema**: Durante l'analisi del contesto per le code review, il plugin andava in crash con errori di tipo `EISDIR` (Error Is a Directory) o `ENOENT` se cercava di leggere directory non tracciate o link simbolici (symlink) rotti.
  * **Soluzione**: Modificata la scansione dei file per escludere esplicitamente le cartelle non tracciate e i link simbolici corrotti.
* **`codex/plugin-fix-git-bash-shell`**
  * **Problema**: Su sistemi Windows, lo spawning dei comandi shell ignorava la preferenza dell'utente nel caso in cui stesse eseguendo una sessione Git Bash, forzando l'uso di `cmd.exe` o PowerShell.
  * **Soluzione**: Introdotto il controllo e rispetto della variabile d'ambiente `SHELL` anche per Windows. Stabilizzati, inoltre, i test per i background task riducendone la sensibilità alle tempistiche.
* **`codex/plugin-large-diff-fix`**
  * **Problema**: Quando la dimensione del diff generato da Git superava i limiti del buffer standard del processo figlio di Node.js, l'applicazione andava in crash con errore `ENOBUFS` (No buffer space available).
  * **Soluzione**: Implementato il controllo preventivo della dimensione del diff e la gestione sicura dell'allocazione del buffer. Preservato anche il contenuto non tracciato durante le review leggere.

### Branch di Rilascio (`release/*`)

* **`release/v1.0.1`**
  * **Problema/Soluzione**: Consolidato il fix relativo all'utilizzo di `shell: true` su sistemi Windows per risolvere gli shim `.cmd` (unito dal branch di CI).
* **`release/v1.0.2`**
  * **Problema**: Il comando `/codex:rescue` falliva nel rispettare la firma e il contratto dell'interfaccia interattiva `AskUserQuestion` di Claude Code (passando opzioni non conformi).
  * **Soluzione**: Allineato il codice dei comandi interattivi per aderire strettamente allo schema `AskUserQuestion` definito da Claude Code.
* **`release/v1.0.3`**
  * **Problema**: I comandi `/codex:cancel` e la selezione implicita di ripresa di un task (quando `/codex:rescue` veniva invocato senza parametri) agivano anche su job e sessioni avviati in altre istanze parallele di Claude o in sessioni passate.
  * **Soluzione**: Circoscritta la selezione dei job in background filtrandoli in base all'ID di sessione corrente (`session_id`).
* **`release/v1.0.4`**
  * **Problema**:
    1. Si verificava un problema di ricorsione infinita delle skill quando Claude cercava di delegare un compito a `/codex:rescue` all'interno di un'altra skill.
    2. Nei comandi slash `/codex:cancel`, `/codex:result` e `/codex:status`, i parametri passati dagli utenti rischiavano il fallimento a causa di word splitting o injection se la variabile `$ARGUMENTS` non era correttamente racchiusa da apici.
  * **Soluzione**:
    1. Instradate le chiamate di `/codex:rescue` tramite lo strumento agente nativo di Claude Code anziché tramite richiamo diretto, rompendo i loop ricorsivi.
    2. Racchiusa la variabile `"$ARGUMENTS"` all'interno di doppi apici in tutte le ricette Markdown dei comandi del plugin.

---

## 7. Passi Operativi per la Migrazione

Per realizzare il nuovo plugin basato su Antigravity, procedere secondo i seguenti passaggi:

1. **Predisposizione del Repository**:
   * Copiare la struttura del plugin originale `plugins/codex/` in una nuova cartella `plugins/agy/`.
   * Rinominare i metadati in `plugins/agy/.claude-plugin/plugin.json` (impostando `name: "agy"`, `description: "Google Antigravity plugin for Claude Code"`, ecc.).
2. **Aggiornamento dei Comandi Slash**:
   * Rinominare i comandi sotto `plugins/agy/commands/` (es. `review.md`, `setup.md`, ecc.).
   * Sostituire le descrizioni interne e i riferimenti a `codex-companion.mjs` con il nuovo script compagno `agy-companion.mjs` (o `agy-companion-server.py`).
3. **Scrittura dello Script Ponte (Broker)**:
   * Sviluppare `agy-companion-server.py` per avviare l'agente Python `google.antigravity` ed esporre le interfacce JSON-RPC richieste dal protocollo di Claude Code.
4. **Validazione e Test**:
   * Utilizzare la CLI `agy` per convalidare il plugin locale:
     ```bash
     agy plugin validate plugins/agy
     ```
   * Installare ed abilitare il plugin nel proprio ambiente per verificarne l'esecuzione interattiva e in background.

