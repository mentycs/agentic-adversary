/**
 * Caso d'uso (Use Case) per l'esecuzione del setup del plugin Antigravity (/agy:setup).
 * Questo file rappresenta il nucleo del dominio di business (Core Domain) nell'architettura esagonale.
 */
export class SetupUseCase {
  /**
   * Crea un'istanza del caso d'uso del setup.
   * @param {import("../ports/shell-port.mjs").ShellPort} shellPort - La porta per eseguire comandi shell.
   * @param {import("../ports/file-system-port.mjs").FileSystemPort} fileSystemPort - La porta per l'accesso al file system.
   */
  constructor(shellPort, fileSystemPort) {
    this.shellPort = shellPort;
    this.fileSystemPort = fileSystemPort;
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
   *     quota: { status: 'ok'|'error'|'warning', message: string }
   *   }
   * }>}
   */
  async execute() {
    // Eseguiamo tutti i controlli concorrentemente con Promise.all per evitare colli di bottiglia sequenziali.
    const [agyCli, configDir, quota] = await Promise.all([
      this._checkAgyCli(),
      this._checkConfigDir(),
      this._checkQuota()
    ]);

    // Il plugin è pronto se i controlli principali sono 'ok' e la quota non ha generato errori bloccanti.
    // (Nota: lo stato di warning sulla quota consente comunque il funzionamento, quindi quota.status !== "error").
    const isReady = agyCli.status === "ok" &&
                    configDir.status === "ok" &&
                    quota.status !== "error";

    return {
      isReady,
      checks: {
        agyCli,
        configDir,
        quota
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
}
