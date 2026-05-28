import { spawnSync } from "node:child_process";
import process from "node:process";
import { runCommand, binaryAvailable } from "./process.mjs";

/**
 * Restituisce lo stato del runtime della sessione corrente.
 * Poiché utilizziamo il wrapping diretto della CLI agy (Approccio A),
 * non c'è un demone/broker persistente.
 * @param {Object} [env] - Variabili d'ambiente.
 * @param {string} [cwd] - Directory di lavoro corrente.
 * @returns {Object} Lo stato del runtime.
 */
export function getSessionRuntimeStatus(env = process.env, cwd = process.cwd()) {
  return {
    mode: "direct",
    label: "avvio diretto",
    detail: "Nessun runtime condiviso attivo. La CLI agy viene invocata direttamente per ciascun comando.",
    endpoint: null
  };
}

/**
 * Verifica se la CLI agy è disponibile ed esegue il parsing della versione.
 * @param {string} cwd - Directory di lavoro corrente.
 * @returns {Object} Stato di disponibilità.
 */
export function getAgyAvailability(cwd) {
  const isWin = process.platform === "win32";
  const shellOption = isWin ? (process.env.SHELL || true) : false;
  return binaryAvailable("agy", ["--version"], { cwd, shell: shellOption });
}

/**
 * Recupera e analizza la quota rimanente per la CLI agy.
 * @param {string} cwd - Directory di lavoro corrente.
 * @returns {Promise<Object>} Stato della quota.
 */
export async function getAgyQuota(cwd) {
  try {
    const isWin = process.platform === "win32";
    const shellOption = isWin ? (process.env.SHELL || true) : false;
    const result = runCommand("agy", ["quota", "--json"], { cwd, shell: shellOption });

    if (result.status !== 0) {
      const errText = (result.stderr + "\n" + result.stdout).toLowerCase();

      if (
        result.status === 401 ||
        errText.includes("unauthorized") ||
        errText.includes("expired") ||
        errText.includes("login") ||
        errText.includes("session")
      ) {
        return {
          status: "error",
          errorType: "login_failure",
          message: `Errore di login: Sessione scaduta o non autorizzata (exit: ${result.status}). Errore: ${result.stderr.trim()}`
        };
      }

      if (
        result.status === 429 ||
        errText.includes("quota exceeded") ||
        errText.includes("rate limit") ||
        errText.includes("limit reached") ||
        errText.includes("429")
      ) {
        return {
          status: "error",
          errorType: "limits_reached",
          message: `Limiti raggiunti: Quota superata o rate limit (exit: ${result.status}). Errore: ${result.stderr.trim()}`
        };
      }

      return {
        status: "error",
        message: `Errore durante la verifica della quota (exit: ${result.status}). Errore: ${result.stderr.trim()}`
      };
    }

    const data = JSON.parse(result.stdout);
    if (typeof data.total !== "number" || typeof data.remaining !== "number") {
      return {
        status: "error",
        message: "Formato output quota non valido."
      };
    }

    return {
      status: "ok",
      total: data.total,
      remaining: data.remaining
    };
  } catch (error) {
    return {
      status: "error",
      message: `Errore durante il recupero della quota: ${error.message}`
    };
  }
}
