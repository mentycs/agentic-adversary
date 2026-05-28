import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";

import { ShellPort } from "../../../../src/ports/shell-port.mjs";
import { FileSystemPort } from "../../../../src/ports/file-system-port.mjs";
import { StatePort } from "../../../../src/ports/state-port.mjs";
import { InteractionPort } from "../../../../src/ports/interaction-port.mjs";
import { getConfig, setConfig } from "./state.mjs";

export class NodeShellAdapter extends ShellPort {
  constructor(cwd = process.cwd()) {
    super();
    this.cwd = cwd;
  }

  async execute(command, args = []) {
    return new Promise((resolve) => {
      const isWin = process.platform === "win32";
      const shellOption = isWin ? (process.env.SHELL || true) : false;
      const child = spawn(command, args, {
        cwd: this.cwd,
        env: process.env,
        shell: shellOption,
        windowsHide: true
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        resolve({
          exitCode: code ?? 0,
          stdout,
          stderr
        });
      });

      child.on("error", (err) => {
        resolve({
          exitCode: 1,
          stdout: "",
          stderr: err.message
        });
      });
    });
  }
}

export class NodeFileSystemAdapter extends FileSystemPort {
  constructor(cwd = process.cwd()) {
    super();
    this.cwd = cwd;
  }

  async exists(filePath) {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(this.cwd, filePath);
    return fs.existsSync(fullPath);
  }

  async readFile(filePath) {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(this.cwd, filePath);
    return fs.promises.readFile(fullPath, "utf8");
  }
}

export class NodeStateAdapter extends StatePort {
  constructor(workspaceRoot) {
    super();
    this.workspaceRoot = workspaceRoot;
  }

  async loadConfig() {
    return getConfig(this.workspaceRoot);
  }

  async saveConfig(configPatch) {
    for (const [key, value] of Object.entries(configPatch)) {
      setConfig(this.workspaceRoot, key, value);
    }
  }
}

export class NodeInteractionAdapter extends InteractionPort {
  async selectOption(question, choices) {
    return new Promise((resolve) => {
      console.log(`\n${question}`);
      choices.forEach((choice, index) => {
        console.log(`  ${index + 1}) ${choice}`);
      });

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const ask = () => {
        rl.question(`Seleziona un'opzione (1-${choices.length}): `, (answer) => {
          const num = parseInt(answer.trim(), 10);
          if (num >= 1 && num <= choices.length) {
            rl.close();
            resolve(choices[num - 1]);
          } else {
            console.log(`Input non valido. Inserisci un numero da 1 a ${choices.length}.`);
            ask();
          }
        });
      };

      ask();
    });
  }
}
