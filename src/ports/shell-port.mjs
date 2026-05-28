/**
 * Porta (Port) per l'esecuzione dei comandi di shell.
 * Definisce l'interfaccia che deve essere implementata dagli adapter di sistema o dai mock nei test.
 */
export class ShellPort {
  /**
   * Esegue un comando shell in modo asincrono.
   * @param {string} command - Il comando da eseguire (es. 'agy', 'python3').
   * @param {string[]} args - Gli argomenti da passare al comando.
   * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
   */
  async execute(command, args = []) {
    throw new Error("Metodo 'execute' non implementato nella classe base ShellPort");
  }
}
