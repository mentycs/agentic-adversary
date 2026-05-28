/**
 * Caso d'uso (Use Case) per l'esecuzione del setup del plugin Antigravity (/agy:setup).
 * Questo file rappresenta il nucleo del dominio di business (Core Domain) nell'architettura esagonale.
 */
export class SetupUseCase {
  /**
   * Crea un'istanza del caso d'uso del setup.
   * @param {import("../ports/shell-port.mjs").ShellPort} shellPort - La porta per eseguire comandi shell.
   * @param {import("../ports/file-system-port.mjs").FileSystemPort} fileSystemPort - La porta per l'accesso al file system.
   * @param {import("../ports/state-port.mjs").StatePort} statePort - La porta per lo stato persistente.
   */
  constructor(shellPort, fileSystemPort, statePort) {
    this.shellPort = shellPort;
    this.fileSystemPort = fileSystemPort;
    this.statePort = statePort;
  }

  /**
   * Esegue i controlli necessari per verificare lo stato di installazione e configurazione di Antigravity.
   * I controlli vengono eseguiti in parallelo per ottimizzare le prestazioni.
   * In caso di eccezioni durante l'esecuzione di una porta, l'errore viene catturato e tradotto in
   * uno stato di errore specifico senza interrompere gli altri controlli.
   *
   * @returns {Promise<{
   *   isReady: boolean,
   *   checks: {
   *     agyCli: { status: 'ok'|'error', message: string },
   *     configDir: { status: 'ok'|'error', message: string },
   *     quota: { status: 'ok'|'error'|'warning', message: string },
   *     modelValidation: { status: 'ok'|'error', message: string }
   *   }
   * }>}
   */
  async execute() {
    // Eseguiamo tutti i controlli concorrentemente con Promise.all per evitare colli di bottiglia sequenziali.
    const [agyCli, configDir, quota, modelValidation] = await Promise.all([
      this._checkAgyCli(),
      this._checkConfigDir(),
      this._checkQuota(),
      this._checkModelValidation()
    ]);

    // Il plugin è pronto se i controlli principali e la validazione del modello sono 'ok' e la quota non ha generato errori bloccanti.
    // (Nota: lo stato di warning sulla quota consente comunque il funzionamento, quindi quota.status !== "error").
    const isReady = agyCli.status === "ok" &&
                    configDir.status === "ok" &&
                    quota.status !== "error" &&
                    modelValidation.status === "ok";

    return {
      isReady,
      checks: {
        agyCli,
        configDir,
        quota,
        modelValidation
      }
    };
  }

  /**
   * Verifica se la CLI 'agy' è installata ed esegue il parsing della versione.
   * @private
   */
  async _checkAgyCli() {
    try {
      const result = await this.shellPort.execute("agy", ["--version"]);
      if (result.exitCode !== 0) {
        return {
          status: "error",
          message: `CLI 'agy' non funzionante o non installata (exit code: ${result.exitCode}). Errore: ${result.stderr.trim()}`
        };
      }

      // Regex robusta per individuare la versione nel formato semantico (es. 1.0.0) dallo stdout
      const match = result.stdout.match(/(\d+\.\d+\.\d+(?:-\w+(?:\.\d+)?)?)/);
      const versione = match ? match[1] : "sconosciuta";

      return {
        status: "ok",
        message: `CLI 'agy' installata e funzionante (versione ${versione})`
      };
    } catch (error) {
      // Garantiamo la sicurezza rispetto alle eccezioni catturando qualsiasi errore del porting
      return {
        status: "error",
        message: `Errore durante la verifica della CLI 'agy': ${error.message}`
      };
    }
  }



  /**
   * Verifica se la directory locale di configurazione '.antigravitycli' esiste nel workspace.
   * @private
   */
  async _checkConfigDir() {
    try {
      const exists = await this.fileSystemPort.exists(".antigravitycli");
      if (!exists) {
        return {
          status: "error",
          message: "Directory locale di configurazione '.antigravitycli' non presente"
        };
      }
      return {
        status: "ok",
        message: "Directory di configurazione '.antigravitycli' presente"
      };
    } catch (error) {
      return {
        status: "error",
        message: `Errore durante la verifica della cartella di configurazione: ${error.message}`
      };
    }
  }

  /**
   * Monitora i limiti e la quota rimanente per l'utente.
   * Esegue la CLI agy per recuperare le metriche di quota ed emette un warning se la quota rimanente è < 20%.
   * @private
   */
  async _checkQuota() {
    try {
      const result = await this.shellPort.execute("agy", ["quota", "--json"]);
      
      if (result.exitCode !== 0) {
        const errText = (result.stderr + "\n" + result.stdout).toLowerCase();
        
        // 1. Gestione Login Failure (unauthorized, session expired)
        if (
          result.exitCode === 401 ||
          errText.includes("unauthorized") ||
          errText.includes("expired") ||
          errText.includes("login") ||
          errText.includes("session")
        ) {
          return {
            status: "error",
            errorType: "login_failure",
            message: `Errore di login: Sessione scaduta o non autorizzata (exit code: ${result.exitCode}). Errore: ${result.stderr.trim()}`
          };
        }
        
        // 2. Gestione Limits Reached (quota exceeded, rate limit, 429)
        if (
          result.exitCode === 429 ||
          errText.includes("quota exceeded") ||
          errText.includes("rate limit") ||
          errText.includes("limit reached") ||
          errText.includes("429")
        ) {
          return {
            status: "error",
            errorType: "limits_reached",
            message: `Limiti raggiunti: Quota superata o rate limit (exit code: ${result.exitCode}). Errore: ${result.stderr.trim()}`
          };
        }
        
        return {
          status: "error",
          message: `Errore durante la verifica della quota (exit code: ${result.exitCode}). Errore: ${result.stderr.trim()}`
        };
      }

      const data = JSON.parse(result.stdout);
      if (typeof data.total !== "number" || typeof data.remaining !== "number") {
        return {
          status: "error",
          message: "Formato output quota non valido"
        };
      }

      const percent = (data.remaining / data.total) * 100;
      
      if (percent < 20) {
        return {
          status: "warning",
          message: `Quota in esaurimento (inferiore al 20%): ${percent.toFixed(1)}% rimanente (${data.remaining}/${data.total})`
        };
      }

      return {
        status: "ok",
        message: `Quota sufficiente: ${percent.toFixed(1)}% rimanente (${data.remaining}/${data.total})`
      };
    } catch (error) {
      return {
        status: "error",
        message: `Errore durante la verifica della quota: ${error.message}`
      };
    }
  }

  /**
   * Esegue la validazione del modello selezionato nello stato contro i modelli disponibili nella CLI.
   * @private
   */
  async _checkModelValidation() {
    try {
      if (!this.statePort) {
        return {
          status: "error",
          message: "StatePort non configurato per la validazione del modello"
        };
      }

      const config = await this.statePort.loadConfig();
      let selectedModel = config ? config.selectedModel : null;

      const availableModels = await this._getAvailableModels();

      if (!selectedModel) {
        // Se non è stato selezionato alcun modello, usiamo gemini-3.5-flash come predefinito
        const defaultModel = "gemini-3.5-flash";
        await this.statePort.saveConfig({ selectedModel: defaultModel });
        selectedModel = defaultModel;
      }

      if (!availableModels.includes(selectedModel)) {
        return {
          status: "error",
          message: `Il modello selezionato '${selectedModel}' non è disponibile in agy`
        };
      }

      return {
        status: "ok",
        message: `Modello selezionato '${selectedModel}' valido`
      };
    } catch (error) {
      return {
        status: "error",
        message: `Errore durante la validazione del modello: ${error.message}`
      };
    }
  }

  /**
   * Recupera la lista di modelli disponibili da agy, con fallback statico se la CLI non li espone.
   * @private
   */
  async _getAvailableModels() {
    const FALLBACK_MODELS = [
      "gemini-3.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
      "gemini-2.0-pro"
    ];

    let stdout = "";
    try {
      const result = await this.shellPort.execute("agy", ["model"]);
      if (result.exitCode === 0) {
        stdout = result.stdout;
      } else {
        const helpResult = await this.shellPort.execute("agy", ["--help"]);
        if (helpResult.exitCode === 0) {
          stdout = helpResult.stdout;
        }
      }
    } catch (err) {
      try {
        const helpResult = await this.shellPort.execute("agy", ["--help"]);
        if (helpResult.exitCode === 0) {
          stdout = helpResult.stdout;
        }
      } catch (innerErr) {
        // Ignora e usa il fallback
      }
    }

    const parsedModels = this._parseModels(stdout);
    // Se il parsing non restituisce modelli utili o cattura l'aiuto testuale generale di agy
    const hasValidModels = parsedModels.length > 0 && 
                           !parsedModels.some(m => m.toLowerCase().includes("usage") || m.toLowerCase().includes("subcommand"));

    if (!hasValidModels) {
      return FALLBACK_MODELS;
    }

    return parsedModels;
  }

  /**
   * Analizza l'output del comando o del fallback per estrarre la lista di modelli.
   * @private
   */
  _parseModels(stdout) {
    if (!stdout || !stdout.trim()) {
      return [];
    }

    const models = [];
    const lines = stdout.split(/\r?\n/);
    let hasBullets = false;

    for (let line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("-") || trimmed.startsWith("*")) {
        const m = trimmed.substring(1).trim();
        if (m) {
          models.push(m);
          hasBullets = true;
        }
      }
    }

    if (!hasBullets) {
      const match = stdout.match(/(?:Modelli supportati:|Supported models:)\s*([^\n]+)/i);
      if (match) {
        const listStr = match[1];
        const parts = listStr.split(/[,\s]+/).map(p => p.trim()).filter(Boolean);
        models.push(...parts);
      } else {
        for (let line of lines) {
          const trimmed = line.trim();
          if (trimmed && trimmed.length < 50 && !trimmed.includes(" ") && !trimmed.includes(":")) {
            models.push(trimmed);
          }
        }
      }
    }

    return models;
  }
}
