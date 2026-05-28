import test from "node:test";
import assert from "node:assert/strict";
import { SetupUseCase } from "../src/core/setup-use-case.mjs";
import { ShellPort } from "../src/ports/shell-port.mjs";
import { FileSystemPort } from "../src/ports/file-system-port.mjs";

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

// Mock per la porta del File System
class MockFileSystemPort extends FileSystemPort {
  constructor(existsMock, readFileMock) {
    super();
    this.existsMock = existsMock;
    this.readFileMock = readFileMock;
    this.calls = [];
  }

  async exists(path) {
    this.calls.push({ path });
    return this.existsMock(path);
  }

  async readFile(path) {
    this.calls.push({ path });
    return this.readFileMock ? this.readFileMock(path) : "";
  }
}

test("SetupUseCase - Successo completo quando tutti i controlli sono superati", async () => {
  // Configurazione dei Mock per simulare un ambiente corretto e pronto
  const shellMock = new MockShellPort(async (command, args) => {
    if (command === "agy" && args.includes("--version")) {
      return { exitCode: 0, stdout: "agy versione 1.0.0\n", stderr: "" };
    }
    if (command === "agy" && args.join(" ").includes("quota")) {
      return { exitCode: 0, stdout: '{"total": 100, "remaining": 90}\n', stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: "Comando non mockato" };
  });

  const fsMock = new MockFileSystemPort(async (path) => {
    if (path === ".antigravitycli") {
      return true;
    }
    return false;
  });

  const useCase = new SetupUseCase(shellMock, fsMock);
  const result = await useCase.execute();

  // Verifiche del risultato globale
  assert.equal(result.isReady, true, "isReady dovrebbe essere true quando tutti i controlli passano");
  
  // Verifiche dei singoli controlli
  assert.equal(result.checks.agyCli.status, "ok");
  assert.match(result.checks.agyCli.message, /1\.0\.0/);

  assert.equal(result.checks.configDir.status, "ok");
  assert.match(result.checks.configDir.message, /presente/i);

  assert.equal(result.checks.quota.status, "ok");
  assert.match(result.checks.quota.message, /quota/i);

  // Verifiche sull'uso corretto delle porte
  assert.ok(shellMock.calls.some(c => c.command === "agy"), "Dovrebbe verificare la CLI agy");
  assert.ok(fsMock.calls.some(c => c.path === ".antigravitycli"), "Dovrebbe verificare l'esistenza della cartella .antigravitycli");
});

test("SetupUseCase - Fallimento quando la CLI agy non è installata o non risponde", async () => {
  const shellMock = new MockShellPort(async (command, args) => {
    if (command === "agy") {
      // Simula il fallimento del comando agy --version o quota
      return { exitCode: 127, stdout: "", stderr: "agy: command not found\n" };
    }
    return { exitCode: 1, stdout: "", stderr: "Comando non mockato" };
  });

  const fsMock = new MockFileSystemPort(async () => true);

  const useCase = new SetupUseCase(shellMock, fsMock);
  const result = await useCase.execute();

  // Verifiche del risultato globale e specifico
  assert.equal(result.isReady, false, "isReady dovrebbe essere false se la CLI agy fallisce");
  assert.equal(result.checks.agyCli.status, "error");
  assert.match(result.checks.agyCli.message, /non/i); // Deve indicare che non è pronta/installata

  // Gli altri controlli dovrebbero comunque essere andati a buon fine (o gestiti senza crash)
  assert.equal(result.checks.configDir.status, "ok");
});

test("SetupUseCase - Fallimento quando la directory locale di configurazione .antigravitycli non esiste", async () => {
  const shellMock = new MockShellPort(async (command, args) => {
    if (command === "agy" && args.includes("--version")) {
      return { exitCode: 0, stdout: "agy versione 1.0.0\n", stderr: "" };
    }
    if (command === "agy" && args.join(" ").includes("quota")) {
      return { exitCode: 0, stdout: '{"total": 100, "remaining": 90}\n', stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: "Comando non mockato" };
  });

  // .antigravitycli non esiste
  const fsMock = new MockFileSystemPort(async (path) => {
    if (path === ".antigravitycli") return false;
    return true;
  });

  const useCase = new SetupUseCase(shellMock, fsMock);
  const result = await useCase.execute();

  // Verifiche del risultato globale e specifico
  assert.equal(result.isReady, false, "isReady dovrebbe essere false se la cartella locale non esiste");
  assert.equal(result.checks.configDir.status, "error");
  assert.match(result.checks.configDir.message, /non/i);

  assert.equal(result.checks.agyCli.status, "ok");
});

test("SetupUseCase - Stato di warning quando la quota rimanente è inferiore al 20%", async () => {
  const shellMock = new MockShellPort(async (command, args) => {
    if (command === "agy" && args.includes("--version")) {
      return { exitCode: 0, stdout: "agy versione 1.0.0\n", stderr: "" };
    }
    if (command === "agy" && args.join(" ").includes("quota")) {
      return { exitCode: 0, stdout: '{"total": 100, "remaining": 15}\n', stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: "Comando non mockato" };
  });

  const fsMock = new MockFileSystemPort(async (path) => {
    if (path === ".antigravitycli") return true;
    return false;
  });

  const useCase = new SetupUseCase(shellMock, fsMock);
  const result = await useCase.execute();

  // Il setup è comunque pronto (isReady: true), ma la quota è in warning
  assert.equal(result.isReady, true, "isReady dovrebbe essere true anche con quota bassa");
  assert.equal(result.checks.quota.status, "warning", "Lo status della quota deve essere warning");
  assert.match(result.checks.quota.message, /inferiore/i);
});

test("SetupUseCase - Gestione errore della quota per fallimento login (sessione scaduta)", async () => {
  const shellMock = new MockShellPort(async (command, args) => {
    if (command === "agy" && args.includes("--version")) {
      return { exitCode: 0, stdout: "agy versione 1.0.0\n", stderr: "" };
    }
    if (command === "agy" && args.join(" ").includes("quota")) {
      // Simula errore 401 Unauthorized
      return { exitCode: 401, stdout: "", stderr: "Error: Unauthorized. Please login first.\n" };
    }
    return { exitCode: 1, stdout: "", stderr: "Comando non mockato" };
  });

  const fsMock = new MockFileSystemPort(async (path) => {
    if (path === ".antigravitycli") return true;
    return false;
  });

  const useCase = new SetupUseCase(shellMock, fsMock);
  const result = await useCase.execute();

  // Il setup deve fallire (isReady: false) a causa dell'errore di quota bloccante
  assert.equal(result.isReady, false, "isReady deve essere false se la quota riscontra un errore di autenticazione");
  assert.equal(result.checks.quota.status, "error");
  assert.equal(result.checks.quota.errorType, "login_failure");
  assert.match(result.checks.quota.message, /login/i);
});

test("SetupUseCase - Gestione errore della quota per limiti raggiunti (quota superata)", async () => {
  const shellMock = new MockShellPort(async (command, args) => {
    if (command === "agy" && args.includes("--version")) {
      return { exitCode: 0, stdout: "agy versione 1.0.0\n", stderr: "" };
    }
    if (command === "agy" && args.join(" ").includes("quota")) {
      // Simula errore 429 Quota Exceeded
      return { exitCode: 429, stdout: "", stderr: "Error: Quota Exceeded (429 Rate Limit).\n" };
    }
    return { exitCode: 1, stdout: "", stderr: "Comando non mockato" };
  });

  const fsMock = new MockFileSystemPort(async (path) => {
    if (path === ".antigravitycli") return true;
    return false;
  });

  const useCase = new SetupUseCase(shellMock, fsMock);
  const result = await useCase.execute();

  // Il setup deve fallire (isReady: false) a causa del superamento dei limiti
  assert.equal(result.isReady, false, "isReady deve essere false se i limiti sono stati raggiunti");
  assert.equal(result.checks.quota.status, "error");
  assert.equal(result.checks.quota.errorType, "limits_reached");
  assert.match(result.checks.quota.message, /limiti/i);
});
