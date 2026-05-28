/**
 * Porta (Port) per la lettura delle variabili d'ambiente di sistema.
 * Definisce l'interfaccia che deve essere implementata dagli adapter di sistema o dai mock nei test.
 */
export class EnvPort {
  /**
   * Ottiene il valore di una variabile d'ambiente.
   * @param {string} key - Il nome della variabile d'ambiente da recuperare.
   * @returns {string|undefined} Il valore della variabile d'ambiente o undefined se non presente.
   */
  get(key) {
    throw new Error("Metodo 'get' non implementato nella classe base EnvPort");
  }
}
