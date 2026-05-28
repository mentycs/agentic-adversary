import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(SCRIPT_DIR, "..");
const MOCK_BIN_DIR = path.join(WORKSPACE_ROOT, "tests", "mock-bin");
const COMPANION_PATH = path.join(WORKSPACE_ROOT, "plugins", "agy", "scripts", "agy-companion.mjs");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test.before(() => {
  fs.mkdirSync(MOCK_BIN_DIR, { recursive: true });

  // Creiamo lo script mock per agy che sia compatibile ESM
  const mockAgySource = `#!/usr/bin/env node
import process from "node:process";
const args = process.argv.slice(2);

if (args.includes('--version')) {
  process.stdout.write('agy versione 1.2.3\\n');
  process.exit(0);
}

if (args.includes('quota') && args.includes('--json')) {
  if (process.env.MOCK_AGY_QUOTA_ERROR === 'login_failure') {
    process.stderr.write('Unauthorized: Session expired\\n');
    process.exit(401);
  }
  if (process.env.MOCK_AGY_QUOTA_ERROR === 'limits_reached') {
    process.stderr.write('Rate limit exceeded\\n');
    process.exit(429);
  }
  process.stdout.write(JSON.stringify({ total: 100, remaining: 75 }) + '\\n');
  process.exit(0);
}

if (args.includes('model')) {
  process.stdout.write('gemini-1.5-pro\\ngemini-1.5-flash\\ngemini-2.0-flash\\n');
  process.exit(0);
}

if (args.includes('--print')) {
  const printIndex = args.indexOf('--print');
  const text = args[printIndex + 1] || '';
  process.stdout.write('MOCK_OUTPUT: ' + text + '\\n');
  process.exit(0);
}

if (args.includes('--continue')) {
  process.stdout.write('MOCK_OUTPUT: Continuazione sessione\\n');
  process.exit(0);
}

process.stderr.write('Comando mock sconosciuto: ' + args.join(' ') + '\\n');
process.exit(1);
`;

  const mockAgyPath = path.join(MOCK_BIN_DIR, "agy");
  fs.writeFileSync(mockAgyPath, mockAgySource, { mode: 0o755 });

  // Creiamo lo script mock per curl per intercettare le chiamate alle API GitHub
  const mockCurlSource = `#!/usr/bin/env node
import process from "node:process";
const args = process.argv.slice(2);

const urlArg = args.find(a => a.startsWith('https://api.github.com/'));
if (urlArg) {
  if (urlArg.includes('owner/repo-inesistente')) {
    process.stdout.write('HTTP/2 404\\n\\n');
    process.exit(0);
  }
  if (args.some(a => a.includes('ghp_invalid'))) {
    process.stdout.write('HTTP/2 401\\n\\n');
    process.exit(0);
  }
  process.stdout.write('HTTP/2 200\\nContent-Type: application/json\\n\\n{"name": "repo-valido"}\\n');
  process.exit(0);
}

process.stderr.write('Comando curl mock sconosciuto: ' + args.join(' ') + '\\n');
process.exit(1);
`;

  const mockCurlPath = path.join(MOCK_BIN_DIR, "curl");
  fs.writeFileSync(mockCurlPath, mockCurlSource, { mode: 0o755 });
});

test.after(() => {
  fs.rmSync(MOCK_BIN_DIR, { recursive: true, force: true });
});

test("agy-companion setup - output JSON corretto", () => {
  const env = {
    ...process.env,
    PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`
  };
  delete env.GEMINI_API_KEY;

  // Impostiamo prima un modello valido per far passare il controllo del modello
  spawnSync(process.execPath, [COMPANION_PATH, "model", "gemini-1.5-pro"], {
    env,
    encoding: "utf8"
  });

  const res = spawnSync(process.execPath, [COMPANION_PATH, "setup", "--json"], {
    env,
    encoding: "utf8"
  });

  assert.equal(res.status, 0, `Il setup dovrebbe terminare con exit code 0. Error: ${res.stderr}`);
  const report = JSON.parse(res.stdout);
  
  assert.equal(report.ready, true, "Il setup dovrebbe risultare ready con CLI funzionante");
  assert.equal(report.agy.available, true, "La CLI agy dovrebbe risultare disponibile");
  assert.match(report.agy.detail, /1\.2\.3/, "Dovrebbe rilevare la versione corretta");
  assert.equal(report.quota.status, "ok", "La quota dovrebbe essere in stato ok");
});

test("agy-companion setup - errore di login", () => {
  const env = {
    ...process.env,
    PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`,
    MOCK_AGY_QUOTA_ERROR: "login_failure"
  };
  delete env.GEMINI_API_KEY;

  const res = spawnSync(process.execPath, [COMPANION_PATH, "setup", "--json"], {
    env,
    encoding: "utf8"
  });

  assert.equal(res.status, 0);
  const report = JSON.parse(res.stdout);
  assert.equal(report.ready, false, "Non dovrebbe essere ready in caso di login fallito");
  assert.equal(report.auth.loggedIn, false);
  assert.equal(report.auth.requiresAuth, true);
  assert.match(report.auth.detail, /login/);
});

test("agy-companion setup - errore limiti raggiunti", () => {
  const env = {
    ...process.env,
    PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`,
    MOCK_AGY_QUOTA_ERROR: "limits_reached"
  };
  delete env.GEMINI_API_KEY;

  const res = spawnSync(process.execPath, [COMPANION_PATH, "setup", "--json"], {
    env,
    encoding: "utf8"
  });

  assert.equal(res.status, 0);
  const report = JSON.parse(res.stdout);
  assert.equal(report.ready, false, "Non dovrebbe essere ready in caso di quota superata");
  assert.equal(report.auth.loggedIn, true, "L'utente dovrebbe risultare loggato anche se la quota è esaurita");
  assert.equal(report.auth.requiresAuth, false);
  assert.match(report.auth.detail, /quota/);
});

test("agy-companion review - esecuzione in foreground", () => {
  const env = {
    ...process.env,
    PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`,
    GEMINI_API_KEY: "chiave_di_test"
  };

  const res = spawnSync(process.execPath, [COMPANION_PATH, "review"], {
    env,
    encoding: "utf8"
  });

  assert.equal(res.status, 0);
  assert.match(res.stdout, /MOCK_OUTPUT: Esegui una code review approfondita/, "Dovrebbe stampare l'output del mock di agy");
});

test("agy-companion adversarial-review - esecuzione in foreground con focus", () => {
  const env = {
    ...process.env,
    PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`,
    GEMINI_API_KEY: "chiave_di_test"
  };

  const res = spawnSync(process.execPath, [COMPANION_PATH, "adversarial-review", "focus_specifico"], {
    env,
    encoding: "utf8"
  });

  assert.equal(res.status, 0);
  assert.match(res.stdout, /MOCK_OUTPUT: Esegui una adversarial review del workspace\. Focus: focus_specifico/, "Dovrebbe inoltrare il focus al prompt");
});

test("agy-companion task - esecuzione e continuazione", () => {
  const env = {
    ...process.env,
    PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`,
    GEMINI_API_KEY: "chiave_di_test"
  };

  // Test della creazione di un nuovo task
  const resNew = spawnSync(process.execPath, [COMPANION_PATH, "task", "Fai questa modifica"], {
    env,
    encoding: "utf8"
  });
  assert.equal(resNew.status, 0);
  assert.match(resNew.stdout, /MOCK_OUTPUT: Fai questa modifica/);

  // Test della ripresa del task
  const resResume = spawnSync(process.execPath, [COMPANION_PATH, "task", "--resume"], {
    env,
    encoding: "utf8"
  });
  assert.equal(resResume.status, 0);
  assert.match(resResume.stdout, /MOCK_OUTPUT: Continuazione sessione/);
});

test("agy-companion - tracciamento dei job e status/result/cancel", async () => {
  const env = {
    ...process.env,
    PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`,
    GEMINI_API_KEY: "chiave_di_test"
  };

  // Creiamo un job in background
  const resBg = spawnSync(process.execPath, [COMPANION_PATH, "task", "--background", "Task lungo"], {
    env,
    encoding: "utf8"
  });

  assert.equal(resBg.status, 0);
  assert.match(resBg.stdout, /avviata in background come task-/, "Dovrebbe restituire l'ID del job");
  
  const match = resBg.stdout.match(/task-[a-z0-9-]+/);
  assert.ok(match, "Dovrebbe contenere l'ID del job");
  const jobId = match[0];

  // Eseguiamo il polling finché lo stato non è completato/fallito/cancellato
  let statusReport = null;
  const maxRetries = 25;
  for (let i = 0; i < maxRetries; i++) {
    const resStatus = spawnSync(process.execPath, [COMPANION_PATH, "status", jobId, "--json"], {
      env,
      encoding: "utf8"
    });
    assert.equal(resStatus.status, 0);
    statusReport = JSON.parse(resStatus.stdout);
    
    if (statusReport.job.status !== "queued" && statusReport.job.status !== "running") {
      break;
    }
    await sleep(200);
  }

  assert.ok(statusReport, "Dovrebbe esserci un report dello stato");
  assert.equal(statusReport.job.id, jobId);
  assert.ok(["completed", "failed", "cancelled"].includes(statusReport.job.status), `Stato inatteso: ${statusReport.job.status}`);

  // Otteniamo il risultato del job
  const resResult = spawnSync(process.execPath, [COMPANION_PATH, "result", jobId, "--json"], {
    env,
    encoding: "utf8"
  });
  assert.equal(resResult.status, 0);
  const resultReport = JSON.parse(resResult.stdout);
  assert.equal(resultReport.job.id, jobId);
});

test("agy-companion model - impostazione modello valida", () => {
  const env = {
    ...process.env,
    PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`
  };
  delete env.GEMINI_API_KEY;

  const res = spawnSync(process.execPath, [COMPANION_PATH, "model", "gemini-1.5-pro", "--json"], {
    env,
    encoding: "utf8"
  });

  assert.equal(res.status, 0);
  const result = JSON.parse(res.stdout);
  assert.equal(result.success, true);
  assert.equal(result.model, "gemini-1.5-pro");
});

test("agy-companion model - impostazione modello non supportata", () => {
  const env = {
    ...process.env,
    PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`
  };
  delete env.GEMINI_API_KEY;

  const res = spawnSync(process.execPath, [COMPANION_PATH, "model", "modello-non-valido", "--json"], {
    env,
    encoding: "utf8"
  });

  assert.equal(res.status, 1);
  const result = JSON.parse(res.stdout);
  assert.equal(result.success, false);
  assert.match(result.error, /non supportato/);
});

test("agy-companion marketplace-add - successo", () => {
  const env = {
    ...process.env,
    PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`
  };

  const res = spawnSync(process.execPath, [COMPANION_PATH, "marketplace-add", "ghp_valid", "owner/repo", "--json"], {
    env,
    encoding: "utf8"
  });

  assert.equal(res.status, 0, `Exit code errato: ${res.status}. Stderr: ${res.stderr}`);
  const result = JSON.parse(res.stdout);
  assert.equal(result.success, true);
  assert.equal(result.repo, "owner/repo");
});

test("agy-companion marketplace-add - fallimento validazione", () => {
  const env = {
    ...process.env,
    PATH: `${MOCK_BIN_DIR}:${process.env.PATH}`
  };

  const res = spawnSync(process.execPath, [COMPANION_PATH, "marketplace-add", "ghp_invalid", "owner/repo", "--json"], {
    env,
    encoding: "utf8"
  });

  assert.equal(res.status, 1);
  const result = JSON.parse(res.stdout);
  assert.equal(result.success, false);
  assert.match(result.error, /401 Unauthorized/);
});

