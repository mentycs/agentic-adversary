import test from "node:test";
import assert from "node:assert/strict";
import { ModelUseCase } from "../src/core/model-use-case.mjs";
import { ShellPort } from "../src/ports/shell-port.mjs";
import { StatePort } from "../src/ports/state-port.mjs";
import { InteractionPort } from "../src/ports/interaction-port.mjs";

// Mock per la porta di esecuzione Shell
class MockShellPort extends ShellPort {
  constructor(executeMock) {
    super();
    this.executeMock = executeMock;
    this.calls = [];
  }

  async execute(command, args = []) {
    this.calls.push({ command, args });
    return this.executeMock(command, args);
  }
}

// Mock per la porta dello stato persistente
class MockStatePort extends StatePort {
  constructor(initialConfig = {}) {
    super();
    this.config = initialConfig;
    this.calls = [];
  }

  async loadConfig() {
    this.calls.push({ method: "loadConfig" });
    return this.config;
  }

  async saveConfig(config) {
    this.calls.push({ method: "saveConfig", config });
    this.config = { ...this.config, ...config };
  }
}

// Mock per la porta di interazione con l'utente
class MockInteractionPort extends InteractionPort {
  constructor(selectOptionMock) {
    super();
    this.selectOptionMock = selectOptionMock;
    this.calls = [];
  }

  async selectOption(question, choices) {
    this.calls.push({ question, choices });
    return this.selectOptionMock(question, choices);
  }
}

test("ModelUseCase - Impostazione diretta del modello quando il modello fornito è valido", async () => {
  const shellMock = new MockShellPort(async (command, args) => {
    if (command === "agy" && args.includes("model")) {
      return { exitCode: 0, stdout: "gemini-1.5-pro\ngemini-1.5-flash\ngemini-2.0-flash\n", stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: "Comando non mockato" };
  });

  const stateMock = new MockStatePort();
  const interactionMock = new MockInteractionPort(async () => {
    throw new Error("L'interazione non dovrebbe essere chiamata nell'impostazione diretta");
  });

  const useCase = new ModelUseCase(shellMock, stateMock, interactionMock);
  const result = await useCase.execute("gemini-1.5-pro");

  assert.equal(result.success, true);
  assert.equal(result.model, "gemini-1.5-pro");
  assert.equal(stateMock.config.selectedModel, "gemini-1.5-pro", "Il modello selezionato dovrebbe essere salvato nello stato");
  assert.ok(shellMock.calls.some(c => c.command === "agy" && c.args.includes("model")), "Dovrebbe verificare i modelli disponibili");
});

test("ModelUseCase - Fallimento dell'impostazione diretta quando il modello fornito non è supportato", async () => {
  const shellMock = new MockShellPort(async (command, args) => {
    if (command === "agy" && args.includes("model")) {
      return { exitCode: 0, stdout: "gemini-1.5-pro\ngemini-1.5-flash\n", stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: "Comando non mockato" };
  });

  const stateMock = new MockStatePort();
  const useCase = new ModelUseCase(shellMock, stateMock);

  await assert.rejects(
    async () => {
      await useCase.execute("modello-inesistente");
    },
    /non supportato/i,
    "Dovrebbe fallire se il modello non è tra quelli supportati"
  );

  assert.equal(stateMock.config.selectedModel, undefined, "Non dovrebbe salvare alcun modello in caso di fallimento");
});

test("ModelUseCase - Selezione interattiva del modello tramite InteractionPort quando nessun modello è fornito", async () => {
  const shellMock = new MockShellPort(async (command, args) => {
    if (command === "agy" && args.includes("model")) {
      return { exitCode: 0, stdout: "gemini-1.5-pro\ngemini-1.5-flash\n", stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: "Comando non mockato" };
  });

  const stateMock = new MockStatePort();
  const interactionMock = new MockInteractionPort(async (question, choices) => {
    assert.deepEqual(choices, ["gemini-1.5-pro", "gemini-1.5-flash"]);
    return "gemini-1.5-flash";
  });

  const useCase = new ModelUseCase(shellMock, stateMock, interactionMock);
  const result = await useCase.execute();

  assert.equal(result.success, true);
  assert.equal(result.model, "gemini-1.5-flash");
  assert.equal(stateMock.config.selectedModel, "gemini-1.5-flash", "Il modello selezionato interattivamente dovrebbe essere salvato");
  assert.equal(interactionMock.calls.length, 1, "Dovrebbe invocare l'InteractionPort una volta");
});

test("ModelUseCase - Fallimento della selezione interattiva se l'utente non seleziona alcuna opzione", async () => {
  const shellMock = new MockShellPort(async (command, args) => {
    if (command === "agy" && args.includes("model")) {
      return { exitCode: 0, stdout: "gemini-1.5-pro\ngemini-1.5-flash\n", stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: "Comando non mockato" };
  });

  const stateMock = new MockStatePort();
  const interactionMock = new MockInteractionPort(async () => {
    return null; // Simula l'annullamento dell'utente
  });

  const useCase = new ModelUseCase(shellMock, stateMock, interactionMock);

  await assert.rejects(
    async () => {
      await useCase.execute();
    },
    /nessun modello selezionato/i
  );

  assert.equal(stateMock.config.selectedModel, undefined);
});

test("ModelUseCase - Fallimento se si richiede selezione interattiva ma manca InteractionPort", async () => {
  const shellMock = new MockShellPort(async (command, args) => {
    return { exitCode: 0, stdout: "gemini-1.5-pro\n", stderr: "" };
  });

  const stateMock = new MockStatePort();
  const useCase = new ModelUseCase(shellMock, stateMock, null);

  await assert.rejects(
    async () => {
      await useCase.execute();
    },
    /InteractionPort non fornito/i
  );
});

test("ModelUseCase - Fallimento o recupero dei modelli tramite fallback 'agy --help' se 'agy model' non è supportato", async () => {
  const shellMock = new MockShellPort(async (command, args) => {
    if (command === "agy" && args.includes("model")) {
      // 'agy model' fallisce (ad es. comando non supportato in una vecchia versione)
      return { exitCode: 1, stdout: "", stderr: "Comando sconosciuto" };
    }
    if (command === "agy" && args.includes("--help")) {
      // Fallback a --help che elenca i modelli
      return { exitCode: 0, stdout: "Opzioni:\nModelli supportati:\n - gemini-1.5-pro\n - gemini-2.0-flash\n", stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: "Comando non mockato" };
  });

  const stateMock = new MockStatePort();
  const useCase = new ModelUseCase(shellMock, stateMock);

  const result = await useCase.execute("gemini-2.0-flash");

  assert.equal(result.success, true);
  assert.equal(result.model, "gemini-2.0-flash");
  assert.equal(stateMock.config.selectedModel, "gemini-2.0-flash");
  assert.ok(shellMock.calls.some(c => c.command === "agy" && c.args.includes("--help")), "Dovrebbe usare --help come fallback");
});
