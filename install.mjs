#!/usr/bin/env node

/**
 * Script di installazione automatica del plugin Antigravity per Claude Code direttamente da GitHub.
 * Questo script è autocontenuto e non richiede dipendenze da pacchetti npm esterni.
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const STATE_VERSION = 1;
const FALLBACK_STATE_ROOT_DIR = path.join(os.tmpdir(), "agy-companion");
const STATE_FILE_NAME = "state.json";

/**
 * Funzione di utilità per richiedere input all'utente con mascheramento opzionale.
 * @param {string} question - Domanda da porre.
 * @param {boolean} hidden - Se true, maschera i caratteri digitati con asterischi.
 * @returns {Promise<string>} La risposta dell'utente.
 */
function askQuestion(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const promptStr = `${question} `;

    if (hidden) {
      rl._writeToOutput = function _writeToOutput(stringToWrite) {
        if (stringToWrite === "\r\n" || stringToWrite === "\n" || stringToWrite === "\r") {
          rl.output.write(stringToWrite);
          return;
        }
        if (rl.line.length > 0) {
          rl.output.write("\r\x1B[K" + promptStr + "*".repeat(rl.line.length));
        } else {
          rl.output.write("\r\x1B[K" + promptStr);
        }
      };
    }

    rl.question(promptStr, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Risolve la radice del workspace corrente.
 * @param {string} cwd - Directory corrente.
 * @returns {string} La root del workspace.
 */
function resolveWorkspaceRoot(cwd) {
  let current = cwd;
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return cwd;
}

/**
 * Risolve il percorso del file di stato in base al workspace corrente.
 * @param {string} cwd - Directory corrente.
 * @returns {string} Percorso assoluto del file di configurazione dello stato.
 */
function resolveStateFile(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  let canonicalWorkspaceRoot = workspaceRoot;
  try {
    canonicalWorkspaceRoot = fs.realpathSync.native(workspaceRoot);
  } catch {
    canonicalWorkspaceRoot = workspaceRoot;
  }

  const slugSource = path.basename(workspaceRoot) || "workspace";
  const slug = slugSource.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(canonicalWorkspaceRoot).digest("hex").slice(0, 16);
  
  const pluginDataDir = process.env.CLAUDE_PLUGIN_DATA;
  const stateRoot = pluginDataDir ? path.join(pluginDataDir, "state") : FALLBACK_STATE_ROOT_DIR;
  return path.join(stateRoot, `${slug}-${hash}`, STATE_FILE_NAME);
}

/**
 * Effettua il parsing della stringa del repository per estrarre 'owner/repo'.
 * @param {string} repoStr - Nome o URL del repository.
 * @returns {string|null} Il repository normalizzato o null.
 */
function parseGithubRepo(repoStr) {
  if (!repoStr) return null;
  const cleaned = repoStr.trim();
  
  const ownerRepoRegex = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
  if (ownerRepoRegex.test(cleaned)) {
    return cleaned;
  }

  const httpsRegex = /github\.com\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+?)(?:\.git|\/|$)/i;
  const httpsMatch = cleaned.match(httpsRegex);
  if (httpsMatch) {
    return httpsMatch[1];
  }

  const sshRegex = /github\.com:([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+?)(?:\.git|\/|$)/i;
  const sshMatch = cleaned.match(sshRegex);
  if (sshMatch) {
    return sshMatch[1];
  }

  return null;
}

/**
 * Valida i requisiti di sistema minimi.
 */
function checkSystemRequirements() {
  try {
    execSync("curl --version", { stdio: "ignore" });
  } catch {
    console.error("Errore: 'curl' non è installato o non è presente nel PATH.");
    process.exit(1);
  }

  try {
    execSync("unzip -v", { stdio: "ignore" });
  } catch {
    console.error("Errore: 'unzip' non è installato o non è presente nel PATH.");
    process.exit(1);
  }
}

/**
 * Funzione principale dello script di installazione.
 */
async function main() {
  console.log("=== Programma di Installazione del Plugin Antigravity da GitHub ===");
  checkSystemRequirements();

  // Parsing degli argomenti da riga di comando
  const args = process.argv.slice(2);
  let pat = null;
  let repo = null;
  let branch = "main";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--pat" && args[i + 1]) {
      pat = args[i + 1];
      i++;
    } else if (args[i] === "--repo" && args[i + 1]) {
      repo = args[i + 1];
      i++;
    } else if (args[i] === "--branch" && args[i + 1]) {
      branch = args[i + 1];
      i++;
    }
  }

  // Se i parametri non sono forniti via CLI, li chiediamo in modo interattivo
  if (!repo) {
    repo = await askQuestion("Inserisci il repository GitHub da cui installare (es. owner/repo o URL completo):");
    if (!repo) {
      console.error("Errore: Il repository GitHub è obbligatorio.");
      process.exit(1);
    }
  }

  const normalizedRepo = parseGithubRepo(repo);
  if (!normalizedRepo) {
    console.error(`Errore: Il formato del repository '${repo}' non è valido.`);
    process.exit(1);
  }

  // Chiediamo se si desidera configurare un PAT
  if (!pat) {
    const usePat = await askQuestion("Il repository è privato o vuoi usare un PAT di GitHub per l'autenticazione? (s/N):");
    if (usePat.toLowerCase() === "s" || usePat.toLowerCase() === "si" || usePat.toLowerCase() === "y" || usePat.toLowerCase() === "yes") {
      pat = await askQuestion("Inserisci il tuo Personal Access Token (PAT) di GitHub:", true);
      if (!pat) {
        console.error("Errore: Il PAT è richiesto per l'autenticazione privata.");
        process.exit(1);
      }
    }
  }

  // Creazione della cartella temporanea per il download
  const tmpDir = path.join(os.tmpdir(), `agy-install-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const archivePath = path.join(tmpDir, "archive.zip");

  console.log(`\nDownload dell'archivio da GitHub per il repository: ${normalizedRepo} (branch: ${branch})...`);
  
  // Costruzione del comando curl per scaricare lo zipball
  const curlHeaders = [
    '-H "Accept: application/vnd.github+json"',
    '-H "User-Agent: agy-companion-install"'
  ];
  if (pat) {
    curlHeaders.push(`-H "Authorization: token ${pat}"`);
  }

  const downloadUrl = `https://api.github.com/repos/${normalizedRepo}/zipball/${branch}`;
  const curlCommand = `curl -f -sL ${curlHeaders.join(" ")} "${downloadUrl}" -o "${archivePath}"`;

  try {
    execSync(curlCommand, { stdio: "inherit" });
  } catch (error) {
    console.error(`\nErrore durante il download da GitHub: ${error.message}`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  if (!fs.existsSync(archivePath) || fs.statSync(archivePath).size < 100) {
    console.error("\nErrore: Il download ha prodotto un archivio non valido o vuoto. Verifica il repository, il branch ed il PAT inserito.");
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  console.log("Estrazione dell'archivio...");
  const extractDir = path.join(tmpDir, "extracted");
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    execSync(`unzip -q "${archivePath}" -d "${extractDir}"`, { stdio: "inherit" });
  } catch (error) {
    console.error(`\nErrore durante l'estrazione: ${error.message}`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  // GitHub scompatta in una cartella radice che ha il formato owner-repo-hash
  const rootFiles = fs.readdirSync(extractDir);
  const repoFolder = rootFiles.find((file) => fs.statSync(path.join(extractDir, file)).isDirectory());

  if (!repoFolder) {
    console.error("\nErrore: Struttura dell'archivio estratto non valida (cartella principale non trovata).");
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  const fullRepoFolderPath = path.join(extractDir, repoFolder);
  const pluginSubFolder = path.join(fullRepoFolderPath, "plugins", "agy");

  if (!fs.existsSync(pluginSubFolder)) {
    console.error("\nErrore: Il repository scaricato non contiene la cartella del plugin 'plugins/agy'.");
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  // Percorso definitivo di installazione locale a livello utente
  const destInstallParent = path.join(os.homedir(), ".antigravitycli", "installed");
  const destInstallPath = path.join(destInstallParent, normalizedRepo.replace("/", "-"));
  
  console.log(`Installazione dei sorgenti in: ${destInstallPath}...`);
  fs.mkdirSync(destInstallParent, { recursive: true });

  if (fs.existsSync(destInstallPath)) {
    // Rimuoviamo vecchie installazioni per evitare sovrapposizioni
    fs.rmSync(destInstallPath, { recursive: true, force: true });
  }

  // Spostiamo la cartella scompattata del repo intero nel percorso permanente
  fs.renameSync(fullRepoFolderPath, destInstallPath);

  // Pulizia della cartella temporanea
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // Se è stato fornito un PAT, andiamo a pre-configurarlo nel file di stato del workspace corrente
  const workspaceCwd = process.cwd();
  if (pat) {
    console.log("Configurazione automatica delle credenziali per il workspace corrente...");
    const stateFile = resolveStateFile(workspaceCwd);
    const stateDir = path.dirname(stateFile);
    fs.mkdirSync(stateDir, { recursive: true });

    let stateObj = {
      version: STATE_VERSION,
      config: {
        stopReviewGate: false,
        selectedModel: "gemini-3.5-flash",
        githubPat: pat,
        githubRepo: normalizedRepo
      },
      jobs: []
    };

    if (fs.existsSync(stateFile)) {
      try {
        const currentContent = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        stateObj = {
          ...stateObj,
          ...currentContent,
          config: {
            ...stateObj.config,
            ...(currentContent.config ?? {}),
            githubPat: pat,
            githubRepo: normalizedRepo
          }
        };
      } catch {
        // Usa il default se corrotto
      }
    }

    fs.writeFileSync(stateFile, JSON.stringify(stateObj, null, 2) + "\n", "utf8");
    console.log("Credenziali GitHub salvate nello stato locale con successo.");
  }

  console.log("\n========================================================");
  console.log("SUCCESS: Il plugin Antigravity è stato installato con successo!");
  console.log("========================================================");
  console.log(`\nPercorso sorgenti: ${destInstallPath}`);
  console.log("\nPer abilitare il plugin all'interno di Claude Code:");
  console.log("1. Avvia Claude Code nel tuo workspace.");
  console.log("2. Digita ed esegui il seguente comando:");
  console.log(`   /plugin add ${path.join(destInstallPath, "plugins", "agy")}`);
  console.log("\nUna volta aggiunto il plugin, puoi usare `/agy:setup` per verificarne lo stato.");
  console.log("========================================================\n");
}

main().catch((err) => {
  console.error(`Errore inatteso durante l'installazione: ${err.message}`);
  process.exit(1);
});
