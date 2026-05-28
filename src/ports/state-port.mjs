/**
 * Porta (Port) per la gestione dello stato persistente del plugin.
 * Definisce l'interfaccia che deve essere implementata dagli adapter di sistema o dai mock nei test.
 */
export class StatePort {
  /**
   * Carica la configurazione persistente.
   * @returns {Promise<Object>} La configurazione caricata.
   */
  async loadConfig() {
    throw new Error("Metodo 'loadConfig' non implementato nella classe base StatePort");
  }

  /**
   * Salva la configurazione persistente.
   * @param {Object} config - La configurazione da persistere.
   * @returns {Promise<void>}
   */
  async saveConfig(config) {
    throw new Error("Metodo 'saveConfig' non implementato nella classe base StatePort");
  }
}
