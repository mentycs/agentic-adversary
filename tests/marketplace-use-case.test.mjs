import test from "node:test";
import assert from "node:assert/strict";
import { MarketplaceUseCase } from "../src/core/marketplace-use-case.mjs";
import { ShellPort } from "../src/ports/shell-port.mjs";
import { StatePort } from "../src/ports/state-port.mjs";
import { InteractionPort } from "../src/ports/interaction-port.mjs";

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

class MockInteractionPort extends InteractionPort {
  constructor(askQuestionMock) {
    super();
    this.askQuestionMock = askQuestionMock;
    this.calls = [];
  }

  async askQuestion(question, hidden = false) {
    this.calls.push({ question, hidden });
    return this.askQuestionMock(question, hidden);
  }
}

test("MarketplaceUseCase - Successo completo con argomenti diretti e validazione OK", async () => {
  const shellMock = new MockShellPort(async (command, args) => {
    assert.equal(command, "curl");
    assert.ok(args.includes("Authorization: token ghp_validToken"));
    assert.ok(args.includes("https://api.github.com/repos/owner/repo"));
    return {
      exitCode: 0,
      stdout: "HTTP/2 200\nContent-Type: application/json\n\n{}",
      stderr: ""
    };
  });

  const stateMock = new MockStatePort();
  const interactionMock = new MockInteractionPort(() => {
    throw new Error("L'interazione non dovrebbe essere chiamata.");
  });

  const useCase = new MarketplaceUseCase(shellMock, stateMock, interactionMock);
  const result = await useCase.execute("ghp_validToken", "owner/repo");

  assert.equal(result.success, true);
  assert.equal(result.pat, "ghp_validToken");
  assert.equal(result.repo, "owner/repo");
  assert.equal(stateMock.config.githubPat, "ghp_validToken");
  assert.equal(stateMock.config.githubRepo, "owner/repo");
});

test("MarketplaceUseCase - Successo con parsing del repository da URL HTTPS", async () => {
  const shellMock = new MockShellPort(async (command, args) => {
    assert.ok(args.includes("https://api.github.com/repos/owner/repo"));
    return {
      exitCode: 0,
      stdout: "HTTP/2 200\n\n",
      stderr: ""
    };
  });

  const stateMock = new MockStatePort();
  const useCase = new MarketplaceUseCase(shellMock, stateMock);
  const result = await useCase.execute("ghp_token", "https://github.com/owner/repo.git");

  assert.equal(result.success, true);
  assert.equal(result.repo, "owner/repo");
});

test("MarketplaceUseCase - Acquisizione interattiva se mancano gli argomenti", async () => {
  const shellMock = new MockShellPort(async () => {
    return { exitCode: 0, stdout: "HTTP/1.1 200 OK\n\n", stderr: "" };
  });

  const stateMock = new MockStatePort();
  const interactionMock = new MockInteractionPort(async (question, hidden) => {
    if (hidden) {
      return "ghp_interactiveToken";
    }
    return "owner/repo-interactive";
  });

  const useCase = new MarketplaceUseCase(shellMock, stateMock, interactionMock);
  const result = await useCase.execute();

  assert.equal(result.success, true);
  assert.equal(result.pat, "ghp_interactiveToken");
  assert.equal(result.repo, "owner/repo-interactive");
  assert.equal(interactionMock.calls.length, 2);
  assert.equal(interactionMock.calls[0].hidden, true, "Il PAT dovrebbe essere chiesto nascondendo l'input");
  assert.equal(interactionMock.calls[1].hidden, false, "Il Repo non deve essere nascosto");
});

test("MarketplaceUseCase - Errore se il repository ha un formato non valido", async () => {
  const shellMock = new MockShellPort(async () => {
    return { exitCode: 0, stdout: "HTTP/1.1 200 OK\n\n", stderr: "" };
  });

  const stateMock = new MockStatePort();
  const useCase = new MarketplaceUseCase(shellMock, stateMock);

  await assert.rejects(
    async () => {
      await useCase.execute("ghp_token", "formato-invalido");
    },
    /non è valido/i
  );
});

test("MarketplaceUseCase - Fallimento per PAT non valido (401 Unauthorized)", async () => {
  const shellMock = new MockShellPort(async () => {
    return {
      exitCode: 0,
      stdout: "HTTP/2 401\n\n",
      stderr: ""
    };
  });

  const stateMock = new MockStatePort();
  const useCase = new MarketplaceUseCase(shellMock, stateMock);

  await assert.rejects(
    async () => {
      await useCase.execute("ghp_invalid", "owner/repo");
    },
    /401 Unauthorized/i
  );
  assert.equal(stateMock.config.githubPat, undefined, "Il PAT errato non deve essere salvato");
});

test("MarketplaceUseCase - Fallimento per repository non trovato (404 Not Found)", async () => {
  const shellMock = new MockShellPort(async () => {
    return {
      exitCode: 0,
      stdout: "HTTP/2 404\n\n",
      stderr: ""
    };
  });

  const stateMock = new MockStatePort();
  const useCase = new MarketplaceUseCase(shellMock, stateMock);

  await assert.rejects(
    async () => {
      await useCase.execute("ghp_valid", "owner/repo-inesistente");
    },
    /404 Not Found/i
  );
});

test("MarketplaceUseCase - Fallimento se il comando curl riscontra un errore", async () => {
  const shellMock = new MockShellPort(async () => {
    return {
      exitCode: 6,
      stdout: "",
      stderr: "Could not resolve host"
    };
  });

  const stateMock = new MockStatePort();
  const useCase = new MarketplaceUseCase(shellMock, stateMock);

  await assert.rejects(
    async () => {
      await useCase.execute("ghp_valid", "owner/repo");
    },
    /codice d'uscita 6/i
  );
});
