#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { getAgyAvailability, getAgyQuota, getSessionRuntimeStatus } from "./lib/agy-helpers.mjs";
import { readStdinIfPiped } from "./lib/fs.mjs";
import { binaryAvailable, terminateProcessTree } from "./lib/process.mjs";
import {
  generateJobId,
  getConfig,
  listJobs,
  setConfig,
  upsertJob,
  writeJobFile,
  readJobFile
} from "./lib/state.mjs";
import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  readStoredJob,
  resolveCancelableJob,
  resolveResultJob,
  sortJobsNewestFirst
} from "./lib/job-control.mjs";
import {
  appendLogLine,
  createJobLogFile,
  createJobProgressUpdater,
  createJobRecord,
  createProgressReporter,
  nowIso,
  runTrackedJob,
  SESSION_ID_ENV
} from "./lib/tracked-jobs.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import { SetupUseCase } from "../../../src/core/setup-use-case.mjs";
import { ModelUseCase } from "../../../src/core/model-use-case.mjs";
import { MarketplaceUseCase } from "../../../src/core/marketplace-use-case.mjs";
import {
  NodeShellAdapter,
  NodeFileSystemAdapter,
  NodeStateAdapter,
  NodeInteractionAdapter
} from "./lib/adapters.mjs";
import {
  renderReviewResult,
  renderStoredJobResult,
  renderCancelReport,
  renderJobStatusReport,
  renderSetupReport,
  renderStatusReport,
  renderTaskResult
} from "./lib/render.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_STATUS_WAIT_TIMEOUT_MS = 240000;
const DEFAULT_STATUS_POLL_INTERVAL_MS = 2000;

function printUsage() {
  console.log(
    [
      "Uso:",
      "  node scripts/agy-companion.mjs setup [--enable-review-gate|--disable-review-gate] [--json]",
      "  node scripts/agy-companion.mjs model [modello] [--json]",
      "  node scripts/agy-companion.mjs marketplace-add [pat] [repo] [--pat pat] [--repo repo] [--json]",
      "  node scripts/agy-companion.mjs review [--wait|--background]",
      "  node scripts/agy-companion.mjs adversarial-review [--wait|--background] [focus text]",
      "  node scripts/agy-companion.mjs task [--background] [--resume-last|--resume|--fresh] [prompt]",
      "  node scripts/agy-companion.mjs status [job-id] [--all] [--json]",
      "  node scripts/agy-companion.mjs result [job-id] [--json]",
      "  node scripts/agy-companion.mjs cancel [job-id] [--json]"
    ].join("\n")
  );
}

function outputResult(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(value);
  }
}

function outputCommandResult(payload, rendered, asJson) {
  outputResult(asJson ? payload : rendered, asJson);
}

function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !raw.trim()) {
      return [];
    }
    return splitRawArgumentString(raw);
  }
  return argv;
}

function parseCommandInput(argv, config = {}) {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: {
      C: "cwd",
      ...(config.aliasMap ?? {})
    }
  });
}

function resolveCommandCwd(options = {}) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function resolveCommandWorkspace(options = {}) {
  return resolveWorkspaceRoot(resolveCommandCwd(options));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shorten(text, limit = 96) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function firstMeaningfulLine(text, fallback) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? fallback;
}

function updateJobPid(cwd, jobId, pid) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const storedJob = readStoredJob(workspaceRoot, jobId);
  if (storedJob) {
    storedJob.pid = pid;
    writeJobFile(workspaceRoot, jobId, storedJob);
    upsertJob(workspaceRoot, storedJob);
  }
}

async function buildSetupReportLocal(cwd, actionsTaken = []) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const nodeStatus = binaryAvailable("node", ["--version"], { cwd });
  const npmStatus = binaryAvailable("npm", ["--version"], { cwd });
  
  const shellAdapter = new NodeShellAdapter(cwd);
  const fsAdapter = new NodeFileSystemAdapter(cwd);
  const stateAdapter = new NodeStateAdapter(workspaceRoot);
  
  const setupUseCase = new SetupUseCase(shellAdapter, fsAdapter, stateAdapter);
  const useCaseResult = await setupUseCase.execute();
  const config = getConfig(workspaceRoot);

  let loggedIn = false;
  let detail = "Non autenticato";
  let requiresAuth = true;

  const quotaCheck = useCaseResult.checks.quota;
  if (quotaCheck.status === "ok") {
    loggedIn = true;
    detail = "Autenticazione valida (quota OK)";
    requiresAuth = false;
  } else if (quotaCheck.errorType === "limits_reached") {
    loggedIn = true;
    detail = "Autenticazione valida, ma la quota/limiti di richieste sono stati raggiunti.";
    requiresAuth = false;
  } else if (quotaCheck.errorType === "login_failure") {
    loggedIn = false;
    detail = "Errore di autenticazione: login non effettuato o sessione scaduta.";
    requiresAuth = true;
  } else {
    loggedIn = false;
    detail = quotaCheck.message || "Stato di autenticazione sconosciuto.";
    requiresAuth = true;
  }

  const authStatus = {
    loggedIn,
    detail,
    requiresAuth
  };

  const nextSteps = [];
  if (useCaseResult.checks.agyCli.status !== "ok") {
    nextSteps.push("Installa la CLI agy con `npm install -g @google/antigravity`.");
  }
  if (requiresAuth) {
    nextSteps.push("Effettua l'autenticazione tramite la CLI `agy`.");
  }
  if (useCaseResult.checks.modelValidation.status !== "ok") {
    nextSteps.push("Seleziona un modello con il comando `/agy:model`.");
  }
  if (useCaseResult.checks.githubPat && useCaseResult.checks.githubPat.status === "error") {
    nextSteps.push("Configura o aggiorna il Personal Access Token di GitHub usando `/agy:marketplace-add`.");
  }
  if (!config.stopReviewGate) {
    nextSteps.push("Opzionale: esegui `/agy:setup --enable-review-gate` per abilitare la code review prima della chiusura.");
  }

  return {
    ready: useCaseResult.isReady,
    node: nodeStatus,
    npm: npmStatus,
    agy: {
      available: useCaseResult.checks.agyCli.status === "ok",
      detail: useCaseResult.checks.agyCli.message
    },
    auth: authStatus,
    quota: {
      status: quotaCheck.status,
      message: quotaCheck.message,
      ...(quotaCheck.errorType ? { errorType: quotaCheck.errorType } : {})
    },
    modelValidation: useCaseResult.checks.modelValidation,
    githubPat: useCaseResult.checks.githubPat,
    sessionRuntime: getSessionRuntimeStatus(process.env, workspaceRoot),
    reviewGateEnabled: Boolean(config.stopReviewGate),
    actionsTaken,
    nextSteps
  };
}

async function handleSetup(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "enable-review-gate", "disable-review-gate"]
  });

  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    throw new Error("Scegli --enable-review-gate oppure --disable-review-gate.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const actionsTaken = [];

  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
    actionsTaken.push(`Abilitata la code review prima della chiusura per ${workspaceRoot}.`);
  } else if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
    actionsTaken.push(`Disabilitata la code review prima della chiusura per ${workspaceRoot}.`);
  }

  const finalReport = await buildSetupReportLocal(cwd, actionsTaken);
  outputResult(options.json ? finalReport : renderSetupReport(finalReport), options.json);
}

function ensureAgyAvailable(cwd) {
  const availability = getAgyAvailability(cwd);
  if (!availability.available) {
    throw new Error("La CLI agy non è installata o non risponde. Esegui `/agy:setup`.");
  }
}

function isActiveJobStatus(status) {
  return status === "queued" || status === "running";
}

function getCurrentClaudeSessionId() {
  return process.env[SESSION_ID_ENV] ?? null;
}

function filterJobsForCurrentClaudeSession(jobs) {
  const sessionId = getCurrentClaudeSessionId();
  if (!sessionId) {
    return jobs;
  }
  return jobs.filter((job) => job.sessionId === sessionId);
}

function findLatestResumableTaskJob(jobs) {
  return (
    jobs.find(
      (job) =>
        job.jobClass === "task" &&
        job.status !== "queued" &&
        job.status !== "running"
    ) ?? null
  );
}

async function waitForSingleJobSnapshot(cwd, reference, options = {}) {
  const timeoutMs = Math.max(0, Number(options.timeoutMs) || DEFAULT_STATUS_WAIT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(100, Number(options.pollIntervalMs) || DEFAULT_STATUS_POLL_INTERVAL_MS);
  const deadline = Date.now() + timeoutMs;
  let snapshot = buildSingleJobSnapshot(cwd, reference);

  while (isActiveJobStatus(snapshot.job.status) && Date.now() < deadline) {
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    snapshot = buildSingleJobSnapshot(cwd, reference);
  }

  return {
    ...snapshot,
    waitTimedOut: isActiveJobStatus(snapshot.job.status),
    timeoutMs
  };
}

async function executeAgyRun(request) {
  ensureAgyAvailable(request.cwd);

  const isWin = process.platform === "win32";
  const shellOption = isWin ? (process.env.SHELL || true) : false;

  return new Promise((resolve) => {
    const child = spawn("agy", request.cmdArgs, {
      cwd: request.cwd,
      env: process.env,
      shell: shellOption,
      windowsHide: true
    });

    if (request.jobId) {
      updateJobPid(request.cwd, request.jobId, child.pid);
    }

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      if (request.onProgress) {
        request.onProgress(text);
      }
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      if (request.onProgress) {
        request.onProgress({ message: text, stderrMessage: text });
      }
    });

    child.on("close", (code) => {
      const exitStatus = code ?? 0;
      const success = exitStatus === 0;

      const payload = {
        status: success ? "completed" : "failed",
        stdout,
        stderr
      };

      const rendered = success ? stdout : `Errore di esecuzione agy (exit code ${exitStatus}):\n${stderr}\n${stdout}`;

      resolve({
        exitStatus,
        threadId: request.jobId,
        payload,
        rendered,
        summary: success ? "Operazione completata con successo." : "Operazione fallita.",
        jobTitle: request.jobTitle || "Task Antigravity",
        jobClass: request.jobClass || "task"
      });
    });

    child.on("error", (err) => {
      resolve({
        exitStatus: 1,
        payload: { status: "failed", stderr: err.message },
        rendered: `Errore durante lo spawning del processo agy: ${err.message}`,
        summary: "Errore di spawning.",
        jobTitle: request.jobTitle || "Task Antigravity",
        jobClass: request.jobClass || "task"
      });
    });
  });
}

function createCompanionJob({ prefix, kind, title, workspaceRoot, jobClass, summary, write = false }) {
  return createJobRecord({
    id: generateJobId(prefix),
    kind,
    kindLabel: kind === "adversarial-review" ? "adversarial-review" : (jobClass === "review" ? "review" : "rescue"),
    title,
    workspaceRoot,
    jobClass,
    summary,
    write
  });
}

function createTrackedProgress(job, options = {}) {
  const logFile = options.logFile ?? createJobLogFile(job.workspaceRoot, job.id, job.title);
  return {
    logFile,
    progress: createProgressReporter({
      stderr: Boolean(options.stderr),
      logFile,
      onEvent: createJobProgressUpdater(job.workspaceRoot, job.id)
    })
  };
}

async function runForegroundCommand(job, runner, options = {}) {
  const { logFile, progress } = createTrackedProgress(job, {
    logFile: options.logFile,
    stderr: !options.json
  });
  const execution = await runTrackedJob(job, () => runner(progress), { logFile });
  outputResult(options.json ? execution.payload : execution.rendered, options.json);
  if (execution.exitStatus !== 0) {
    process.exitCode = execution.exitStatus;
  }
  return execution;
}

function spawnDetachedTaskWorker(cwd, jobId) {
  const scriptPath = path.join(ROOT_DIR, "scripts", "agy-companion.mjs");
  const isWin = process.platform === "win32";
  const shellOption = isWin ? (process.env.SHELL || true) : false;

  const child = spawn(process.execPath, [scriptPath, "task-worker", "--cwd", cwd, "--job-id", jobId], {
    cwd,
    env: process.env,
    detached: true,
    stdio: "ignore",
    shell: shellOption,
    windowsHide: true
  });
  child.unref();
  return child;
}

function enqueueBackgroundTask(cwd, job, request) {
  const { logFile } = createTrackedProgress(job);
  appendLogLine(logFile, "Messo in coda per l'esecuzione in background.");

  const child = spawnDetachedTaskWorker(cwd, job.id);
  const queuedRecord = {
    ...job,
    status: "queued",
    phase: "queued",
    pid: child.pid ?? null,
    logFile,
    request
  };
  writeJobFile(job.workspaceRoot, job.id, queuedRecord);
  upsertJob(job.workspaceRoot, queuedRecord);

  return {
    payload: {
      jobId: job.id,
      status: "queued",
      title: job.title,
      summary: job.summary,
      logFile
    },
    logFile
  };
}

async function handleReviewCommand(argv, isAdversarial) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "background", "wait"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const focusText = positionals.join(" ").trim();

  const reviewLabel = isAdversarial ? "Adversarial Review" : "Review";
  const title = `Antigravity ${reviewLabel}`;
  const summary = isAdversarial ? `Adversarial review (focus: ${shorten(focusText)})` : "Code review delle modifiche correnti";

  let prompt = "";
  if (isAdversarial) {
    prompt = `Esegui una adversarial review del workspace. Focus: ${focusText || "Nessun focus extra fornito"}`;
  } else {
    prompt = "Esegui una code review approfondita delle modifiche correnti del workspace. Elenca bug, problemi di design e miglioramenti.";
  }

  const job = createCompanionJob({
    prefix: "review",
    kind: isAdversarial ? "adversarial-review" : "review",
    title,
    workspaceRoot,
    jobClass: "review",
    summary
  });

  const request = {
    cwd,
    cmdArgs: ["--print", prompt],
    jobId: job.id,
    jobTitle: title,
    jobClass: "review"
  };

  if (options.background) {
    ensureAgyAvailable(cwd);
    const { payload } = enqueueBackgroundTask(cwd, job, request);
    const rendered = `${title} avviata in background come ${job.id}. Controlla /agy:status ${job.id} per avanzamento.\n`;
    outputCommandResult(payload, rendered, options.json);
    return;
  }

  await runForegroundCommand(
    job,
    (progress) =>
      executeAgyRun({
        ...request,
        onProgress: progress
      }),
    { json: options.json }
  );
}

async function handleTask(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "resume-last", "resume", "fresh", "background"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const rawPrompt = positionals.join(" ").trim();
  const prompt = rawPrompt || readStdinIfPiped();

  const resume = Boolean(options["resume-last"] || options.resume);
  const fresh = Boolean(options.fresh);
  if (resume && fresh) {
    throw new Error("Scegli o --resume/--resume-last o --fresh.");
  }

  if (!resume && !prompt) {
    throw new Error("Fornisci un prompt, uno standard input o usa --resume.");
  }

  const title = resume ? "Antigravity Resume" : "Antigravity Rescue";
  const summary = resume ? "Ripresa della sessione" : shorten(prompt);

  const job = createCompanionJob({
    prefix: "task",
    kind: "task",
    title,
    workspaceRoot,
    jobClass: "task",
    summary
  });

  const cmdArgs = resume ? ["--continue"] : ["--print", prompt];

  const request = {
    cwd,
    cmdArgs,
    jobId: job.id,
    jobTitle: title,
    jobClass: "task"
  };

  if (options.background) {
    ensureAgyAvailable(cwd);
    const { payload } = enqueueBackgroundTask(cwd, job, request);
    const rendered = `${title} avviata in background come ${job.id}. Controlla /agy:status ${job.id} per avanzamento.\n`;
    outputCommandResult(payload, rendered, options.json);
    return;
  }

  await runForegroundCommand(
    job,
    (progress) =>
      executeAgyRun({
        ...request,
        onProgress: progress
      }),
    { json: options.json }
  );
}

async function handleTaskWorker(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd", "job-id"]
  });

  if (!options["job-id"]) {
    throw new Error("Parametro --job-id mancante per il task-worker.");
  }

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const storedJob = readStoredJob(workspaceRoot, options["job-id"]);
  if (!storedJob) {
    throw new Error(`Nessun job registrato trovato per ${options["job-id"]}.`);
  }

  const request = storedJob.request;
  if (!request || typeof request !== "object") {
    throw new Error(`Il job memorizzato ${options["job-id"]} non contiene le informazioni della richiesta.`);
  }

  const { logFile, progress } = createTrackedProgress(
    {
      ...storedJob,
      workspaceRoot
    },
    {
      logFile: storedJob.logFile ?? null
    }
  );

  await runTrackedJob(
    {
      ...storedJob,
      workspaceRoot,
      logFile
    },
    () =>
      executeAgyRun({
        ...request,
        onProgress: progress
      }),
    { logFile }
  );
}

async function handleStatus(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd", "timeout-ms", "poll-interval-ms"],
    booleanOptions: ["json", "all", "wait"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  if (reference) {
    const snapshot = options.wait
      ? await waitForSingleJobSnapshot(cwd, reference, {
          timeoutMs: options["timeout-ms"],
          pollIntervalMs: options["poll-interval-ms"]
        })
      : buildSingleJobSnapshot(cwd, reference);
    outputCommandResult(snapshot, renderJobStatusReport(snapshot.job), options.json);
    return;
  }

  if (options.wait) {
    throw new Error("La modalità status --wait richiede l'ID di un job.");
  }

  const report = buildStatusSnapshot(cwd, { all: options.all });
  outputResult(options.json ? report : renderStatusReport(report), options.json);
}

function handleResult(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveResultJob(cwd, reference);
  const storedJob = readStoredJob(workspaceRoot, job.id);
  const payload = {
    job,
    storedJob
  };

  outputCommandResult(payload, renderStoredJobResult(job, storedJob), options.json);
}

function handleTaskResumeCandidate(argv) {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const sessionId = getCurrentClaudeSessionId();
  const jobs = filterJobsForCurrentClaudeSession(sortJobsNewestFirst(listJobs(workspaceRoot)));
  const candidate = findLatestResumableTaskJob(jobs);

  const payload = {
    available: Boolean(candidate),
    sessionId,
    candidate:
      candidate == null
        ? null
        : {
            id: candidate.id,
            status: candidate.status,
            title: candidate.title ?? null,
            summary: candidate.summary ?? null,
            completedAt: candidate.completedAt ?? null,
            updatedAt: candidate.updatedAt ?? null
          }
  };

  const rendered = candidate
    ? `Trovato task riprendibile: ${candidate.id} (${candidate.status}).\n`
    : "Nessun task riprendibile trovato per questa sessione.\n";
  outputCommandResult(payload, rendered, options.json);
}

async function handleCancel(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const reference = positionals[0] ?? "";
  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference, { env: process.env });
  const existing = readStoredJob(workspaceRoot, job.id) ?? {};

  // Killa il processo agy in background se il PID è disponibile
  let processTerminated = false;
  if (job.pid) {
    terminateProcessTree(job.pid);
    processTerminated = true;
  }
  appendLogLine(job.logFile, "Annullato dall'utente.");

  const completedAt = nowIso();
  const nextJob = {
    ...job,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    completedAt,
    errorMessage: "Annullato dall'utente."
  };

  writeJobFile(workspaceRoot, job.id, {
    ...existing,
    ...nextJob,
    cancelledAt: completedAt
  });
  upsertJob(workspaceRoot, {
    id: job.id,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    errorMessage: "Annullato dall'utente.",
    completedAt
  });

  const payload = {
    jobId: job.id,
    status: "cancelled",
    title: job.title,
    processTerminated
  };

  outputCommandResult(payload, renderCancelReport(nextJob), options.json);
}

async function handleModel(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const targetModel = positionals[0] ?? null;

  const shellAdapter = new NodeShellAdapter(cwd);
  const stateAdapter = new NodeStateAdapter(workspaceRoot);
  const interactionAdapter = new NodeInteractionAdapter();

  const modelUseCase = new ModelUseCase(shellAdapter, stateAdapter, interactionAdapter);
  
  try {
    const result = await modelUseCase.execute(targetModel);
    const output = {
      success: true,
      model: result.model,
      message: `Modello impostato correttamente a: ${result.model}`
    };
    
    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`\nSuccesso: Modello impostato correttamente a: ${result.model}`);
    }
  } catch (error) {
    const output = {
      success: false,
      error: error.message
    };
    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.error(`\nErrore: ${error.message}`);
    }
    process.exitCode = 1;
  }
}

async function handleMarketplaceAdd(argv) {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd", "pat", "repo"],
    booleanOptions: ["json"]
  });

  const cwd = resolveCommandCwd(options);
  const workspaceRoot = resolveCommandWorkspace(options);
  const targetPat = options.pat ?? positionals[0] ?? null;
  const targetRepo = options.repo ?? positionals[1] ?? null;

  const shellAdapter = new NodeShellAdapter(cwd);
  const stateAdapter = new NodeStateAdapter(workspaceRoot);
  const interactionAdapter = new NodeInteractionAdapter();

  const marketplaceUseCase = new MarketplaceUseCase(shellAdapter, stateAdapter, interactionAdapter);

  try {
    const result = await marketplaceUseCase.execute(targetPat, targetRepo);
    const output = {
      success: true,
      repo: result.repo,
      message: result.message
    };

    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`\nSuccesso: ${result.message}`);
      console.log(`Repository configurato: ${result.repo}`);
    }
  } catch (error) {
    const output = {
      success: false,
      error: error.message
    };
    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.error(`\nErrore: ${error.message}`);
    }
    process.exitCode = 1;
  }
}


async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printUsage();
    return;
  }

  switch (subcommand) {
    case "setup":
      await handleSetup(argv);
      break;
    case "model":
      await handleModel(argv);
      break;
    case "marketplace-add":
      await handleMarketplaceAdd(argv);
      break;
    case "review":
      await handleReviewCommand(argv, false);
      break;
    case "adversarial-review":
      await handleReviewCommand(argv, true);
      break;
    case "task":
      await handleTask(argv);
      break;
    case "task-worker":
      await handleTaskWorker(argv);
      break;
    case "status":
      await handleStatus(argv);
      break;
    case "result":
      handleResult(argv);
      break;
    case "task-resume-candidate":
      handleTaskResumeCandidate(argv);
      break;
    case "cancel":
      await handleCancel(argv);
      break;
    default:
      throw new Error(`Sottocomando sconosciuto: ${subcommand}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
