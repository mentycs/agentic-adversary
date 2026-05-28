/**
 * Porta (Port) per la gestione dell'interazione con l'utente.
 * Definisce l'interfaccia che deve essere implementata dagli adapter di sistema o dai mock nei test.
 */
export class InteractionPort {
  /**
   * Mostra all'utente una domanda con una lista di opzioni tra cui scegliere.
   * @param {string} question - La domanda da mostrare all'utente.
   * @param {string[]} choices - Le opzioni disponibili per la selezione.
   * @returns {Promise<string>} L'opzione scelta dall'utente.
   */
  async selectOption(question, choices) {
    throw new Error("Metodo 'selectOption' non implementato nella classe base InteractionPort");
  }

  /**
   * Chiede all'utente un input testuale diretto.
   * @param {string} question - La domanda da mostrare all'utente.
   * @param {boolean} [hidden] - Se true, maschera l'input durante la digitazione (es. per password/token).
   * @returns {Promise<string>} L'input dell'utente.
   */
  async askQuestion(question, hidden = false) {
    throw new Error("Metodo 'askQuestion' non implementato nella classe base InteractionPort");
  }
}

