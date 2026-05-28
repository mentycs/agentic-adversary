function severityRank(severity) {
  switch (severity) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    default:
      return 3;
  }
}

function formatLineRange(finding) {
  if (!finding.line_start) {
    return "";
  }
  if (!finding.line_end || finding.line_end === finding.line_start) {
    return `:${finding.line_start}`;
  }
  return `:${finding.line_start}-${finding.line_end}`;
}

function validateReviewResultShape(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "Atteso un oggetto JSON di alto livello.";
  }
  if (typeof data.verdict !== "string" || !data.verdict.trim()) {
    return "Campo stringa `verdict` mancante.";
  }
  if (typeof data.summary !== "string" || !data.summary.trim()) {
    return "Campo stringa `summary` mancante.";
  }
  if (!Array.isArray(data.findings)) {
    return "Campo array `findings` mancante.";
  }
  if (!Array.isArray(data.next_steps)) {
    return "Campo array `next_steps` mancante.";
  }
  return null;
}

function normalizeReviewFinding(finding, index) {
  const source = finding && typeof finding === "object" && !Array.isArray(finding) ? finding : {};
  const lineStart = Number.isInteger(source.line_start) && source.line_start > 0 ? source.line_start : null;
  const lineEnd =
    Number.isInteger(source.line_end) && source.line_end > 0 && (!lineStart || source.line_end >= lineStart)
      ? source.line_end
      : lineStart;

  return {
    severity: typeof source.severity === "string" && source.severity.trim() ? source.severity.trim() : "low",
    title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : `Rilevamento ${index + 1}`,
    body: typeof source.body === "string" && source.body.trim() ? source.body.trim() : "Nessun dettaglio fornito.",
    file: typeof source.file === "string" && source.file.trim() ? source.file.trim() : "sconosciuto",
    line_start: lineStart,
    line_end: lineEnd,
    recommendation: typeof source.recommendation === "string" ? source.recommendation.trim() : ""
  };
}

function normalizeReviewResultData(data) {
  return {
    verdict: data.verdict.trim(),
    summary: data.summary.trim(),
    findings: data.findings.map((finding, index) => normalizeReviewFinding(finding, index)),
    next_steps: data.next_steps
      .filter((step) => typeof step === "string" && step.trim())
      .map((step) => step.trim())
  };
}

function isStructuredReviewStoredResult(storedJob) {
  const result = storedJob?.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }
  return (
    Object.prototype.hasOwnProperty.call(result, "result") ||
    Object.prototype.hasOwnProperty.call(result, "parseError")
  );
}

function formatJobLine(job) {
  const parts = [job.id, `${job.status || "sconosciuto"}`];
  if (job.kindLabel) {
    parts.push(job.kindLabel);
  }
  if (job.title) {
    parts.push(job.title);
  }
  return parts.join(" | ");
}

function escapeMarkdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function formatAgyResumeCommand(job) {
  return `/agy:rescue --resume`;
}

function appendActiveJobsTable(lines, jobs) {
  lines.push("Job attivi:");
  lines.push("| Job | Tipo | Stato | Fase | Tempo Trascorso | ID Sessione Antigravity | Sommario | Azioni |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const job of jobs) {
    const actions = [`/agy:status ${job.id}`];
    if (job.status === "queued" || job.status === "running") {
      actions.push(`/agy:cancel ${job.id}`);
    }
    lines.push(
      `| ${escapeMarkdownCell(job.id)} | ${escapeMarkdownCell(job.kindLabel)} | ${escapeMarkdownCell(job.status)} | ${escapeMarkdownCell(job.phase ?? "")} | ${escapeMarkdownCell(job.elapsed ?? "")} | ${escapeMarkdownCell(job.threadId ?? "")} | ${escapeMarkdownCell(job.summary ?? "")} | ${actions.map((action) => `\`${action}\``).join("<br>")} |`
    );
  }
}

function pushJobDetails(lines, job, options = {}) {
  lines.push(`- ${formatJobLine(job)}`);
  if (job.summary) {
    lines.push(`  Sommario: ${job.summary}`);
  }
  if (job.phase) {
    lines.push(`  Fase: ${job.phase}`);
  }
  if (options.showElapsed && job.elapsed) {
    lines.push(`  Tempo trascorso: ${job.elapsed}`);
  }
  if (options.showDuration && job.duration) {
    lines.push(`  Durata: ${job.duration}`);
  }
  if (job.threadId) {
    lines.push(`  ID Sessione Antigravity: ${job.threadId}`);
  }
  const resumeCommand = formatAgyResumeCommand(job);
  if (resumeCommand) {
    lines.push(`  Riprendi in Antigravity: ${resumeCommand}`);
  }
  if (job.logFile && options.showLog) {
    lines.push(`  Log: ${job.logFile}`);
  }
  if ((job.status === "queued" || job.status === "running") && options.showCancelHint) {
    lines.push(`  Cancella: /agy:cancel ${job.id}`);
  }
  if (job.status !== "queued" && job.status !== "running" && options.showResultHint) {
    lines.push(`  Risultato: /agy:result ${job.id}`);
  }
  if (job.status !== "queued" && job.status !== "running" && job.jobClass === "task" && job.write && options.showReviewHint) {
    lines.push("  Rivedi modifiche: /agy:review --wait");
    lines.push("  Review adversarial: /agy:adversarial-review --wait");
  }
  if (job.progressPreview?.length) {
    lines.push("  Avanzamento:");
    for (const line of job.progressPreview) {
      lines.push(`    ${line}`);
    }
  }
}

function appendReasoningSection(lines, reasoningSummary) {
  if (!Array.isArray(reasoningSummary) || reasoningSummary.length === 0) {
    return;
  }

  lines.push("", "Ragionamento:");
  for (const section of reasoningSummary) {
    lines.push(`- ${section}`);
  }
}

export function renderSetupReport(report) {
  const lines = [
    "# Setup di Antigravity",
    "",
    `Stato: ${report.ready ? "pronto" : "richiede attenzione"}`,
    "",
    "Controlli:",
    `- node: ${report.node.detail}`,
    `- npm: ${report.npm.detail}`,
    `- agy: ${report.agy.detail}`,
    `- auth: ${report.auth.detail}`,
    `- modello: ${report.modelValidation ? report.modelValidation.message : "non configurato"}`,
    `- session runtime: ${report.sessionRuntime.label}`,
    `- review gate: ${report.reviewGateEnabled ? "abilitato" : "disabilitato"}`,
    `- github pat: ${report.githubPat ? report.githubPat.message : "non configurato"}`,
    ""
  ];

  if (report.actionsTaken.length > 0) {
    lines.push("Azioni intraprese:");
    for (const action of report.actionsTaken) {
      lines.push(`- ${action}`);
    }
    lines.push("");
  }

  if (report.nextSteps.length > 0) {
    lines.push("Passi successivi:");
    for (const step of report.nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderReviewResult(parsedResult, meta) {
  if (!parsedResult.parsed) {
    const lines = [
      `# Review di Antigravity (${meta.reviewLabel})`,
      "",
      "Antigravity non ha restituito un JSON strutturato valido.",
      "",
      `- Errore di parsing: ${parsedResult.parseError}`
    ];

    if (parsedResult.rawOutput) {
      lines.push("", "Messaggio finale grezzo:", "", "```text", parsedResult.rawOutput, "```");
    }

    appendReasoningSection(lines, meta.reasoningSummary ?? parsedResult.reasoningSummary);

    return `${lines.join("\n").trimEnd()}\n`;
  }

  const validationError = validateReviewResultShape(parsedResult.parsed);
  if (validationError) {
    const lines = [
      `# Review di Antigravity (${meta.reviewLabel})`,
      "",
      `Target: ${meta.targetLabel}`,
      "Antigravity ha restituito un JSON con un formato di review inatteso.",
      "",
      `- Errore di validazione: ${validationError}`
    ];

    if (parsedResult.rawOutput) {
      lines.push("", "Messaggio finale grezzo:", "", "```text", parsedResult.rawOutput, "```");
    }

    appendReasoningSection(lines, meta.reasoningSummary ?? parsedResult.reasoningSummary);

    return `${lines.join("\n").trimEnd()}\n`;
  }

  const data = normalizeReviewResultData(parsedResult.parsed);
  const findings = [...data.findings].sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
  const lines = [
    `# Review di Antigravity (${meta.reviewLabel})`,
    "",
    `Target: ${meta.targetLabel}`,
    `Verdetto: ${data.verdict}`,
    "",
    data.summary,
    ""
  ];

  if (findings.length === 0) {
    lines.push("Nessun problema rilevato.");
  } else {
    lines.push("Problemi riscontrati:");
    for (const finding of findings) {
      const lineSuffix = formatLineRange(finding);
      lines.push(`- [${finding.severity}] ${finding.title} (${finding.file}${lineSuffix})`);
      lines.push(`  ${finding.body}`);
      if (finding.recommendation) {
        lines.push(`  Raccomandazione: ${finding.recommendation}`);
      }
    }
  }

  if (data.next_steps.length > 0) {
    lines.push("", "Passi successivi:");
    for (const step of data.next_steps) {
      lines.push(`- ${step}`);
    }
  }

  appendReasoningSection(lines, meta.reasoningSummary);

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderNativeReviewResult(result, meta) {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  const lines = [
    `# Review di Antigravity (${meta.reviewLabel})`,
    "",
    `Target: ${meta.targetLabel}`,
    ""
  ];

  if (stdout) {
    lines.push(stdout);
  } else if (result.status === 0) {
    lines.push("Review di Antigravity completata senza alcun output su stdout.");
  } else {
    lines.push("Review di Antigravity fallita.");
  }

  if (stderr) {
    lines.push("", "stderr:", "", "```text", stderr, "```");
  }

  appendReasoningSection(lines, meta.reasoningSummary);

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderTaskResult(parsedResult, meta) {
  const rawOutput = typeof parsedResult?.rawOutput === "string" ? parsedResult.rawOutput : "";
  if (rawOutput) {
    return rawOutput.endsWith("\n") ? rawOutput : `${rawOutput}\n`;
  }

  const message = String(parsedResult?.failureMessage ?? "").trim() || "Antigravity non ha restituito un messaggio finale.";
  return `${message}\n`;
}

export function renderStatusReport(report) {
  const lines = [
    "# Stato di Antigravity",
    "",
    `Runtime sessione: ${report.sessionRuntime.label}`,
    `Review gate: ${report.config.stopReviewGate ? "abilitato" : "disabilitato"}`,
    ""
  ];

  if (report.running.length > 0) {
    appendActiveJobsTable(lines, report.running);
    lines.push("");
    lines.push("Dettagli in tempo reale:");
    for (const job of report.running) {
      pushJobDetails(lines, job, {
        showElapsed: true,
        showLog: true
      });
    }
    lines.push("");
  }

  if (report.latestFinished) {
    lines.push("Ultimo completato:");
    pushJobDetails(lines, report.latestFinished, {
      showDuration: true,
      showLog: report.latestFinished.status === "failed"
    });
    lines.push("");
  }

  if (report.recent.length > 0) {
    lines.push("Job recenti:");
    for (const job of report.recent) {
      pushJobDetails(lines, job, {
        showDuration: true,
        showLog: job.status === "failed"
      });
    }
    lines.push("");
  } else if (report.running.length === 0 && !report.latestFinished) {
    lines.push("Nessun job registrato.", "");
  }

  if (report.needsReview) {
    lines.push("Il review gate di chiusura è abilitato.");
    lines.push("La chiusura della sessione avvierà una adversarial review di Antigravity e bloccherà la chiusura se vengono rilevati problemi.");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderJobStatusReport(job) {
  const lines = ["# Stato del Job di Antigravity", ""];
  pushJobDetails(lines, job, {
    showElapsed: job.status === "queued" || job.status === "running",
    showDuration: job.status !== "queued" && job.status !== "running",
    showLog: true,
    showCancelHint: true,
    showResultHint: true,
    showReviewHint: true
  });
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderStoredJobResult(job, storedJob) {
  const threadId = storedJob?.threadId ?? job.threadId ?? null;
  const resumeCommand = `/agy:rescue --resume`;
  if (isStructuredReviewStoredResult(storedJob) && storedJob?.rendered) {
    const output = storedJob.rendered.endsWith("\n") ? storedJob.rendered : `${storedJob.rendered}\n`;
    if (!threadId) {
      return output;
    }
    return `${output}\nID Sessione Antigravity: ${threadId}\nRiprendi in Antigravity: ${resumeCommand}\n`;
  }

  const rawOutput =
    (typeof storedJob?.result?.rawOutput === "string" && storedJob.result.rawOutput) ||
    (typeof storedJob?.result?.agy?.stdout === "string" && storedJob.result.agy.stdout) ||
    "";
  if (rawOutput) {
    const output = rawOutput.endsWith("\n") ? rawOutput : `${rawOutput}\n`;
    if (!threadId) {
      return output;
    }
    return `${output}\nID Sessione Antigravity: ${threadId}\nRiprendi in Antigravity: ${resumeCommand}\n`;
  }

  if (storedJob?.rendered) {
    const output = storedJob.rendered.endsWith("\n") ? storedJob.rendered : `${storedJob.rendered}\n`;
    if (!threadId) {
      return output;
    }
    return `${output}\nID Sessione Antigravity: ${threadId}\nRiprendi in Antigravity: ${resumeCommand}\n`;
  }

  const lines = [
    `# ${job.title ?? "Risultato Antigravity"}`,
    "",
    `Job: ${job.id}`,
    `Stato: ${job.status}`
  ];

  if (threadId) {
    lines.push(`ID Sessione Antigravity: ${threadId}`);
    lines.push(`Riprendi in Antigravity: ${resumeCommand}`);
  }

  if (job.summary) {
    lines.push(`Sommario: ${job.summary}`);
  }

  if (job.errorMessage) {
    lines.push("", job.errorMessage);
  } else if (storedJob?.errorMessage) {
    lines.push("", storedJob.errorMessage);
  } else {
    lines.push("", "Nessun risultato memorizzato per questo job.");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderCancelReport(job) {
  const lines = [
    "# Cancellazione Job di Antigravity",
    "",
    `Cancellato ${job.id}.`,
    ""
  ];

  if (job.title) {
    lines.push(`- Titolo: ${job.title}`);
  }
  if (job.summary) {
    lines.push(`- Sommario: ${job.summary}`);
  }
  lines.push("- Controlla `/agy:status` per la coda aggiornata.");

  return `${lines.join("\n").trimEnd()}\n`;
}
