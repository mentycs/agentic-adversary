/**
 * Caso d'uso (Use Case) per l'installazione e l'abilitazione tramite GitHub Marketplace con PAT.
 * Questo file fa parte del Core Domain dell'architettura esagonale del plugin.
 */
export class MarketplaceUseCase {
  /**
   * Crea un'istanza del caso d'uso del Marketplace.
   * @param {import("../ports/shell-port.mjs").ShellPort} shellPort - Porta per i comandi shell.
   * @param {import("../ports/state-port.mjs").StatePort} statePort - Porta per lo stato persistente.
   * @param {import("../ports/interaction-port.mjs").InteractionPort} interactionPort - Porta per l'interazione con l'utente.
   */
  constructor(shellPort, statePort, interactionPort) {
    this.shellPort = shellPort;
    this.statePort = statePort;
    this.interactionPort = interactionPort;
  }

  /**
   * Esegue il caso d'uso per configurare e validare il PAT di GitHub e il repository.
   * @param {string} [targetPat] - PAT di GitHub opzionale.
   * @param {string} [targetRepo] - Nome o URL del repository GitHub opzionale.
   * @returns {Promise<{ success: boolean, pat: string, repo: string, message: string }>} Il risultato della configurazione.
   */
  async execute(targetPat = null, targetRepo = null) {
    let pat = targetPat ? targetPat.trim() : null;
    let rawRepo = targetRepo ? targetRepo.trim() : null;

    // Se mancano i parametri, li acquisiamo interattivamente usando l'InteractionPort
    if (!pat) {
      if (!this.interactionPort) {
        throw new Error("Impossibile acquisire il PAT: InteractionPort non fornito e nessun PAT passato come argomento.");
      }
      pat = await this.interactionPort.askQuestion("Inserisci il Personal Access Token (PAT) di GitHub:", true);
      if (!pat) {
        throw new Error("L'inserimento del PAT di GitHub è obbligatorio.");
      }
    }

    if (!rawRepo) {
      if (!this.interactionPort) {
        throw new Error("Impossibile acquisire il repository: InteractionPort non fornito e nessun repository passato come argomento.");
      }
      rawRepo = await this.interactionPort.askQuestion("Inserisci il nome (owner/repo) o l'URL del repository GitHub:");
      if (!rawRepo) {
        throw new Error("L'inserimento del repository di GitHub è obbligatorio.");
      }
    }

    // Effettuiamo il parsing del repository per assicurarci di avere il formato 'owner/repo'
    const parsedRepo = this.parseGithubRepo(rawRepo);
    if (!parsedRepo) {
      throw new Error(`Il formato del repository fornito '${rawRepo}' non è valido. Usa il formato 'owner/repo' o un URL valido di GitHub.`);
    }

    // Validiamo le credenziali chiamando l'API di GitHub tramite curl con il ShellPort
    const validation = await this._validateGithubCredentials(pat, parsedRepo);
    if (!validation.valid) {
      throw new Error(`Validazione fallita su GitHub: ${validation.message}`);
    }

    // Se la validazione ha successo, salviamo le configurazioni nel config persistente
    await this.statePort.saveConfig({
      githubPat: pat,
      githubRepo: parsedRepo
    });

    return {
      success: true,
      pat,
      repo: parsedRepo,
      message: "Credenziali GitHub salvate e validate con successo."
    };
  }

  /**
   * Estrae il percorso 'owner/repo' da una stringa che può essere un nome o un URL completo.
   * @param {string} repoStr - Stringa da analizzare.
   * @returns {string|null} Il repository normalizzato o null se non valido.
   */
  parseGithubRepo(repoStr) {
    if (!repoStr) return null;
    const cleaned = repoStr.trim();
    
    // Formato owner/repo
    const ownerRepoRegex = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
    if (ownerRepoRegex.test(cleaned)) {
      return cleaned;
    }

    // URL HTTPS (es: https://github.com/owner/repo o https://github.com/owner/repo.git)
    const httpsRegex = /github\.com\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+?)(?:\.git|\/|$)/i;
    const httpsMatch = cleaned.match(httpsRegex);
    if (httpsMatch) {
      return httpsMatch[1];
    }

    // URL SSH (es: git@github.com:owner/repo.git)
    const sshRegex = /github\.com:([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+?)(?:\.git|\/|$)/i;
    const sshMatch = cleaned.match(sshRegex);
    if (sshMatch) {
      return sshMatch[1];
    }

    return null;
  }

  /**
   * Valida il PAT e il repository facendo una chiamata curl all'API di GitHub.
   * @param {string} pat - Il Personal Access Token.
   * @param {string} repo - Il repository in formato owner/repo.
   * @returns {Promise<{ valid: boolean, message?: string }>} Risultato della validazione.
   * @private
   */
  async _validateGithubCredentials(pat, repo) {
    try {
      // Eseguiamo la chiamata usando curl. Aggiungiamo anche lo User-Agent per evitare 403 da GitHub
      const result = await this.shellPort.execute("curl", [
        "-s",
        "-i",
        "-H", `Authorization: token ${pat}`,
        "-H", "User-Agent: agy-companion",
        `https://api.github.com/repos/${repo}`
      ]);

      if (result.exitCode !== 0) {
        return {
          valid: false,
          message: `Chiamata curl fallita con codice d'uscita ${result.exitCode}. Errore: ${result.stderr.trim()}`
        };
      }

      const stdout = result.stdout;
      const httpStatusMatch = stdout.match(/HTTP\/\d+(?:\.\d+)?\s+(\d+)/);
      if (!httpStatusMatch) {
        return {
          valid: false,
          message: "Risposta da GitHub non valida (codice HTTP non trovato nell'header)."
        };
      }

      const statusCode = parseInt(httpStatusMatch[1], 10);
      if (statusCode === 200) {
        return { valid: true };
      }

      if (statusCode === 401) {
        return {
          valid: false,
          message: "PAT di GitHub non valido o scaduto (401 Unauthorized)."
        };
      }

      if (statusCode === 404) {
        return {
          valid: false,
          message: `Repository '${repo}' non trovato o PAT privo di autorizzazione per accedervi (404 Not Found).`
        };
      }

      return {
        valid: false,
        message: `Risposta HTTP non attesa da GitHub con codice di stato ${statusCode}.`
      };
    } catch (error) {
      return {
        valid: false,
        message: `Errore durante la connessione con l'API di GitHub: ${error.message}`
      };
    }
  }
}
