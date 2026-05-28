/**
 * Porta (Port) per l'accesso e la manipolazione del File System.
 * Definisce l'interfaccia che deve essere implementata dagli adapter di sistema o dai mock nei test.
 */
export class FileSystemPort {
  /**
   * Verifica asincronamente se un determinato percorso esiste sul file system.
   * @param {string} path - Il percorso del file o della cartella.
   * @returns {Promise<boolean>} Vero se esiste, falso altrimenti.
   */
  async exists(path) {
    throw new Error("Metodo 'exists' non implementato nella classe base FileSystemPort");
  }

  /**
   * Legge asincronamente il contenuto di un file come stringa UTF-8.
   * @param {string} path - Il percorso del file da leggere.
   * @returns {Promise<string>} Il contenuto del file.
   */
  async readFile(path) {
    throw new Error("Metodo 'readFile' non implementato nella classe base FileSystemPort");
  }
}
