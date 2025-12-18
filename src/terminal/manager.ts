import * as vscode from 'vscode';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface CommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    duration: number;
}

export interface TerminalProcess {
    id: string;
    command: string;
    status: 'running' | 'completed' | 'failed';
    output: string[];
    exitCode?: number;
}

export class TerminalManager {
    private terminals: Map<string, vscode.Terminal> = new Map();
    private processes: Map<string, TerminalProcess> = new Map();
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Autonomous Architect Terminal');
    }

    async executeCommand(
        command: string,
        cwd?: string,
        timeout: number = 300000 // 5 minutes default
    ): Promise<CommandResult> {
        const startTime = Date.now();

        this.log(`Executing: ${command}`);

        try {
            const { stdout, stderr } = await execAsync(command, {
                cwd: cwd || this.getWorkspaceRoot(),
                timeout,
                maxBuffer: 10 * 1024 * 1024, // 10MB
                env: { ...process.env }
            });

            const duration = Date.now() - startTime;

            this.log(`✅ Command completed in ${duration}ms`);
            if (stdout) this.log(`STDOUT:\n${stdout}`);
            if (stderr) this.log(`STDERR:\n${stderr}`);

            return {
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode: 0,
                duration
            };
        } catch (error: any) {
            const duration = Date.now() - startTime;

            this.log(`❌ Command failed after ${duration}ms`);
            this.log(`Error: ${error.message}`);
            if (error.stdout) this.log(`STDOUT:\n${error.stdout}`);
            if (error.stderr) this.log(`STDERR:\n${error.stderr}`);

            return {
                stdout: error.stdout || '',
                stderr: error.stderr || error.message,
                exitCode: error.code || 1,
                duration
            };
        }
    }

    async executeWithRetry(
        command: string,
        maxRetries: number = 3,
        cwd?: string
    ): Promise<CommandResult> {
        let lastError: CommandResult | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            this.log(`Attempt ${attempt}/${maxRetries}: ${command}`);

            const result = await this.executeCommand(command, cwd);

            if (result.exitCode === 0) {
                return result;
            }

            lastError = result;

            if (attempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                this.log(`Retrying in ${delay}ms...`);
                await this.sleep(delay);
            }
        }

        throw new Error(`Command failed after ${maxRetries} attempts: ${lastError?.stderr}`);
    }

    async executeInteractive(command: string, name?: string): Promise<string> {
        const terminalName = name || `Autonomous Architect - ${Date.now()}`;
        const terminal = vscode.window.createTerminal({
            name: terminalName,
            cwd: this.getWorkspaceRoot()
        });

        this.terminals.set(terminalName, terminal);

        terminal.show();
        terminal.sendText(command);

        return terminalName;
    }

    async runBuildCommand(): Promise<CommandResult> {
        const workspaceRoot = this.getWorkspaceRoot();

        // Detect build command from package.json
        try {
            const fs = require('fs/promises');
            const path = require('path');
            const packageJsonPath = path.join(workspaceRoot, 'package.json');
            const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

            if (packageJson.scripts?.build) {
                return await this.executeCommand('npm run build');
            }
        } catch {}

        // Try common build commands
        const buildCommands = [
            'npm run build',
            'yarn build',
            'pnpm build',
            'tsc',
            'python setup.py build',
            'go build',
            'cargo build'
        ];

        for (const cmd of buildCommands) {
            const testResult = await this.executeCommand(`which ${cmd.split(' ')[0]}`);
            if (testResult.exitCode === 0) {
                return await this.executeCommand(cmd);
            }
        }

        throw new Error('No build command detected');
    }

    async runTests(): Promise<CommandResult> {
        const workspaceRoot = this.getWorkspaceRoot();

        // Detect test command from package.json
        try {
            const fs = require('fs/promises');
            const path = require('path');
            const packageJsonPath = path.join(workspaceRoot, 'package.json');
            const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

            if (packageJson.scripts?.test) {
                return await this.executeCommand('npm test');
            }
        } catch {}

        // Try common test commands
        const testCommands = [
            'npm test',
            'yarn test',
            'pnpm test',
            'jest',
            'pytest',
            'go test ./...',
            'cargo test'
        ];

        for (const cmd of testCommands) {
            const testResult = await this.executeCommand(`which ${cmd.split(' ')[0]}`);
            if (testResult.exitCode === 0) {
                return await this.executeCommand(cmd);
            }
        }

        return {
            stdout: 'No tests found',
            stderr: '',
            exitCode: 0,
            duration: 0
        };
    }

    async installDependencies(): Promise<CommandResult> {
        const workspaceRoot = this.getWorkspaceRoot();

        // Check for package.json (Node.js)
        try {
            const fs = require('fs/promises');
            const path = require('path');
            await fs.access(path.join(workspaceRoot, 'package.json'));

            // Detect package manager
            const hasYarnLock = await fs.access(path.join(workspaceRoot, 'yarn.lock')).then(() => true).catch(() => false);
            const hasPnpmLock = await fs.access(path.join(workspaceRoot, 'pnpm-lock.yaml')).then(() => true).catch(() => false);

            if (hasPnpmLock) {
                return await this.executeCommand('pnpm install');
            } else if (hasYarnLock) {
                return await this.executeCommand('yarn install');
            } else {
                return await this.executeCommand('npm install');
            }
        } catch {}

        // Check for requirements.txt (Python)
        try {
            const fs = require('fs/promises');
            const path = require('path');
            await fs.access(path.join(workspaceRoot, 'requirements.txt'));
            return await this.executeCommand('pip install -r requirements.txt');
        } catch {}

        // Check for go.mod (Go)
        try {
            const fs = require('fs/promises');
            const path = require('path');
            await fs.access(path.join(workspaceRoot, 'go.mod'));
            return await this.executeCommand('go mod download');
        } catch {}

        return {
            stdout: 'No dependency file found',
            stderr: '',
            exitCode: 0,
            duration: 0
        };
    }

    parseErrors(output: string): string[] {
        const errors: string[] = [];
        const lines = output.split('\n');

        const errorPatterns = [
            /error:/i,
            /ERROR/,
            /exception:/i,
            /failed/i,
            /cannot find/i,
            /not found/i,
            /undefined/i,
            /syntax error/i,
            /type error/i,
            /reference error/i
        ];

        for (const line of lines) {
            for (const pattern of errorPatterns) {
                if (pattern.test(line)) {
                    errors.push(line.trim());
                    break;
                }
            }
        }

        return errors;
    }

    private getWorkspaceRoot(): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder open');
        }
        return workspaceFolder.uri.fsPath;
    }

    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    dispose(): void {
        for (const terminal of this.terminals.values()) {
            terminal.dispose();
        }
        this.terminals.clear();
        this.outputChannel.dispose();
    }
}
