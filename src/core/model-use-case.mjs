/**
 * Caso d'uso (Use Case) per la gestione del comando di selezione del modello (/agy:model).
 * Questo file fa parte del Core Domain dell'architettura esagonale.
 */
export class ModelUseCase {
  /**
   * Crea un'istanza del caso d'uso per la selezione del modello.
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
   * Esegue il caso d'uso per selezionare e salvare un modello.
   * @param {string} [targetModel] - Modello specifico da impostare direttamente.
   * @returns {Promise<{ success: boolean, model: string }>} Il risultato del caso d'uso.
   */
  async execute(targetModel = null) {
    const availableModels = await this._getAvailableModels();

    if (targetModel) {
      if (!availableModels.includes(targetModel)) {
        throw new Error(`Il modello fornito '${targetModel}' non supportato. Modelli disponibili: ${availableModels.join(", ")}`);
      }
      await this.statePort.saveConfig({ selectedModel: targetModel });
      return { success: true, model: targetModel };
    }

    if (!this.interactionPort) {
      throw new Error("InteractionPort non fornito per la selezione interattiva.");
    }

    const selectedModel = await this.interactionPort.selectOption("Seleziona un modello da configurare per agy:", availableModels);
    if (!selectedModel) {
      throw new Error("Nessun modello selezionato dall'utente.");
    }

    await this.statePort.saveConfig({ selectedModel });
    return { success: true, model: selectedModel };
  }

  /**
   * Recupera la lista di modelli disponibili da agy, con fallback a --help se 'agy model' fallisce.
   * @private
   */
  async _getAvailableModels() {
    let stdout = "";
    try {
      const result = await this.shellPort.execute("agy", ["model"]);
      if (result.exitCode === 0) {
        stdout = result.stdout;
      } else {
        const helpResult = await this.shellPort.execute("agy", ["--help"]);
        if (helpResult.exitCode === 0) {
          stdout = helpResult.stdout;
        } else {
          throw new Error("Errore durante l'esecuzione del comando agy model e del fallback agy --help.");
        }
      }
    } catch (err) {
      try {
        const helpResult = await this.shellPort.execute("agy", ["--help"]);
        if (helpResult.exitCode === 0) {
          stdout = helpResult.stdout;
        } else {
          throw new Error(`Errore generato dal comando agy: ${err.message}`);
        }
      } catch (innerErr) {
        throw new Error(`Errore durante il recupero dei modelli: ${err.message}`);
      }
    }

    return this._parseModels(stdout);
  }

  /**
   * Analizza l'output del comando o del fallback per estrarre la lista di modelli.
   * @private
   */
  _parseModels(stdout) {
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
          if (trimmed) {
            models.push(trimmed);
          }
        }
      }
    }

    return models;
  }
}
