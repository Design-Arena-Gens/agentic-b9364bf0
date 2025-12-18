import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface FileInfo {
    path: string;
    content: string;
    language: string;
    size: number;
    lastModified: Date;
}

export class FileManager {
    private workspaceRoot: string;

    constructor() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder open');
        }
        this.workspaceRoot = workspaceFolder.uri.fsPath;
    }

    async readFile(filePath: string): Promise<string> {
        try {
            const fullPath = this.resolvePath(filePath);
            return await fs.readFile(fullPath, 'utf-8');
        } catch (error) {
            // File doesn't exist, return empty string
            return '';
        }
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        const fullPath = this.resolvePath(filePath);

        // Ensure directory exists
        const dir = path.dirname(fullPath);
        await fs.mkdir(dir, { recursive: true });

        await fs.writeFile(fullPath, content, 'utf-8');

        // Open file in editor if not already open
        const uri = vscode.Uri.file(fullPath);
        await vscode.workspace.openTextDocument(uri);
    }

    async deleteFile(filePath: string): Promise<void> {
        const fullPath = this.resolvePath(filePath);
        await fs.unlink(fullPath);
    }

    async listFiles(dirPath: string = '.', pattern?: string): Promise<string[]> {
        const fullPath = this.resolvePath(dirPath);

        if (pattern) {
            // Use simple fs readdir for now
            const entries = await fs.readdir(fullPath, { withFileTypes: true });
            return entries
                .filter(entry => entry.isFile())
                .map(entry => entry.name);
        }

        const entries = await fs.readdir(fullPath, { withFileTypes: true });
        return entries
            .filter(entry => entry.isFile())
            .map(entry => entry.name);
    }

    async findFiles(pattern: string): Promise<string[]> {
        // Simple recursive file search without glob dependency
        const files: string[] = [];
        await this.recursiveFileSearch(this.workspaceRoot, files, pattern);
        return files;
    }

    private async recursiveFileSearch(dir: string, files: string[], pattern?: string): Promise<void> {
        const excludeDirs = ['node_modules', '.git', 'dist', 'build'];
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory() && !excludeDirs.includes(entry.name)) {
                    await this.recursiveFileSearch(fullPath, files, pattern);
                } else if (entry.isFile()) {
                    const relativePath = path.relative(this.workspaceRoot, fullPath);
                    if (!pattern || this.matchesPattern(relativePath, pattern)) {
                        files.push(relativePath);
                    }
                }
            }
        } catch (error) {
            // Ignore permission errors
        }
    }

    private matchesPattern(filePath: string, pattern: string): boolean {
        // Simple pattern matching
        if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            return regex.test(filePath);
        }
        return filePath.includes(pattern);
    }

    async getFileInfo(filePath: string): Promise<FileInfo | null> {
        try {
            const fullPath = this.resolvePath(filePath);
            const stat = await fs.stat(fullPath);
            const content = await fs.readFile(fullPath, 'utf-8');

            return {
                path: filePath,
                content,
                language: this.detectLanguage(filePath),
                size: stat.size,
                lastModified: stat.mtime
            };
        } catch (error) {
            return null;
        }
    }

    async analyzeProjectStructure(): Promise<Record<string, any>> {
        const structure: Record<string, any> = {
            root: this.workspaceRoot,
            packageJson: null,
            tsconfig: null,
            srcFiles: [],
            testFiles: [],
            configFiles: []
        };

        // Check for package.json
        try {
            const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
            const packageJson = await fs.readFile(packageJsonPath, 'utf-8');
            structure.packageJson = JSON.parse(packageJson);
        } catch {}

        // Check for tsconfig.json
        try {
            const tsconfigPath = path.join(this.workspaceRoot, 'tsconfig.json');
            const tsconfig = await fs.readFile(tsconfigPath, 'utf-8');
            structure.tsconfig = JSON.parse(tsconfig);
        } catch {}

        // Find source files
        structure.srcFiles = await this.findFiles('src/**/*.{ts,js,tsx,jsx,py,go}');

        // Find test files
        structure.testFiles = await this.findFiles('**/*.{test,spec}.{ts,js,tsx,jsx,py}');

        // Find config files
        structure.configFiles = await this.findFiles('*.{json,yaml,yml,config.js}');

        return structure;
    }

    async detectProjectType(): Promise<string> {
        // Check for package.json (Node.js)
        try {
            const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
            await fs.access(packageJsonPath);
            return 'node';
        } catch {}

        // Check for requirements.txt or setup.py (Python)
        try {
            const requirementsPath = path.join(this.workspaceRoot, 'requirements.txt');
            await fs.access(requirementsPath);
            return 'python';
        } catch {}

        try {
            const setupPyPath = path.join(this.workspaceRoot, 'setup.py');
            await fs.access(setupPyPath);
            return 'python';
        } catch {}

        // Check for go.mod (Go)
        try {
            const goModPath = path.join(this.workspaceRoot, 'go.mod');
            await fs.access(goModPath);
            return 'go';
        } catch {}

        // Check for Cargo.toml (Rust)
        try {
            const cargoPath = path.join(this.workspaceRoot, 'Cargo.toml');
            await fs.access(cargoPath);
            return 'rust';
        } catch {}

        return 'unknown';
    }

    async createDirectory(dirPath: string): Promise<void> {
        const fullPath = this.resolvePath(dirPath);
        await fs.mkdir(fullPath, { recursive: true });
    }

    async copyFile(sourcePath: string, destPath: string): Promise<void> {
        const fullSourcePath = this.resolvePath(sourcePath);
        const fullDestPath = this.resolvePath(destPath);

        const dir = path.dirname(fullDestPath);
        await fs.mkdir(dir, { recursive: true });

        await fs.copyFile(fullSourcePath, fullDestPath);
    }

    async moveFile(sourcePath: string, destPath: string): Promise<void> {
        const fullSourcePath = this.resolvePath(sourcePath);
        const fullDestPath = this.resolvePath(destPath);

        const dir = path.dirname(fullDestPath);
        await fs.mkdir(dir, { recursive: true });

        await fs.rename(fullSourcePath, fullDestPath);
    }

    private resolvePath(filePath: string): string {
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        return path.join(this.workspaceRoot, filePath);
    }

    private detectLanguage(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const languageMap: Record<string, string> = {
            '.ts': 'typescript',
            '.tsx': 'typescriptreact',
            '.js': 'javascript',
            '.jsx': 'javascriptreact',
            '.py': 'python',
            '.go': 'go',
            '.rs': 'rust',
            '.java': 'java',
            '.cpp': 'cpp',
            '.c': 'c',
            '.json': 'json',
            '.yaml': 'yaml',
            '.yml': 'yaml',
            '.md': 'markdown',
            '.html': 'html',
            '.css': 'css',
            '.scss': 'scss'
        };
        return languageMap[ext] || 'plaintext';
    }

    getWorkspaceRoot(): string {
        return this.workspaceRoot;
    }
}
