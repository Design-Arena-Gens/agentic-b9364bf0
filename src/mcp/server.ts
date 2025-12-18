import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface MCPResource {
    uri: string;
    type: 'file' | 'directory' | 'terminal' | 'browser';
    metadata?: Record<string, any>;
}

export interface MCPTool {
    name: string;
    description: string;
    inputSchema: Record<string, any>;
}

/**
 * MCP (Model Context Protocol) Server
 * Provides unified access to file system, terminal, and browser resources
 */
export class MCPServer {
    private resources: Map<string, MCPResource> = new Map();
    private tools: Map<string, MCPTool> = new Map();

    constructor() {
        this.registerTools();
    }

    private registerTools(): void {
        // File system tools
        this.tools.set('fs_read', {
            name: 'fs_read',
            description: 'Read file contents',
            inputSchema: { path: 'string' }
        });

        this.tools.set('fs_write', {
            name: 'fs_write',
            description: 'Write file contents',
            inputSchema: { path: 'string', content: 'string' }
        });

        this.tools.set('fs_list', {
            name: 'fs_list',
            description: 'List directory contents',
            inputSchema: { path: 'string' }
        });

        this.tools.set('fs_create_dir', {
            name: 'fs_create_dir',
            description: 'Create directory',
            inputSchema: { path: 'string' }
        });

        // Terminal tools
        this.tools.set('terminal_exec', {
            name: 'terminal_exec',
            description: 'Execute terminal command',
            inputSchema: { command: 'string', cwd: 'string' }
        });

        // Browser tools
        this.tools.set('browser_open', {
            name: 'browser_open',
            description: 'Open URL in browser',
            inputSchema: { url: 'string' }
        });
    }

    async executeTool(toolName: string, args: Record<string, any>): Promise<any> {
        switch (toolName) {
            case 'fs_read':
                return await this.fsRead(args.path);

            case 'fs_write':
                return await this.fsWrite(args.path, args.content);

            case 'fs_list':
                return await this.fsList(args.path);

            case 'fs_create_dir':
                return await this.fsCreateDir(args.path);

            case 'terminal_exec':
                return await this.terminalExec(args.command, args.cwd);

            case 'browser_open':
                return await this.browserOpen(args.url);

            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    // File System Operations
    private async fsRead(filePath: string): Promise<string> {
        try {
            const workspaceRoot = this.getWorkspaceRoot();
            const fullPath = path.join(workspaceRoot, filePath);
            return await fs.readFile(fullPath, 'utf-8');
        } catch (error) {
            throw new Error(`Failed to read file: ${error}`);
        }
    }

    private async fsWrite(filePath: string, content: string): Promise<void> {
        try {
            const workspaceRoot = this.getWorkspaceRoot();
            const fullPath = path.join(workspaceRoot, filePath);

            // Ensure directory exists
            const dir = path.dirname(fullPath);
            await fs.mkdir(dir, { recursive: true });

            await fs.writeFile(fullPath, content, 'utf-8');
        } catch (error) {
            throw new Error(`Failed to write file: ${error}`);
        }
    }

    private async fsList(dirPath: string): Promise<string[]> {
        try {
            const workspaceRoot = this.getWorkspaceRoot();
            const fullPath = path.join(workspaceRoot, dirPath);
            return await fs.readdir(fullPath);
        } catch (error) {
            throw new Error(`Failed to list directory: ${error}`);
        }
    }

    private async fsCreateDir(dirPath: string): Promise<void> {
        try {
            const workspaceRoot = this.getWorkspaceRoot();
            const fullPath = path.join(workspaceRoot, dirPath);
            await fs.mkdir(fullPath, { recursive: true });
        } catch (error) {
            throw new Error(`Failed to create directory: ${error}`);
        }
    }

    // Terminal Operations
    private async terminalExec(command: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
        try {
            const workspaceRoot = this.getWorkspaceRoot();
            const execCwd = cwd ? path.join(workspaceRoot, cwd) : workspaceRoot;

            const { stdout, stderr } = await execAsync(command, {
                cwd: execCwd,
                maxBuffer: 10 * 1024 * 1024 // 10MB
            });

            return { stdout, stderr };
        } catch (error: any) {
            return {
                stdout: error.stdout || '',
                stderr: error.stderr || error.message
            };
        }
    }

    // Browser Operations
    private async browserOpen(url: string): Promise<void> {
        await vscode.env.openExternal(vscode.Uri.parse(url));
    }

    // Resource Management
    async getResource(uri: string): Promise<MCPResource | undefined> {
        return this.resources.get(uri);
    }

    async listResources(): Promise<MCPResource[]> {
        return Array.from(this.resources.values());
    }

    registerResource(resource: MCPResource): void {
        this.resources.set(resource.uri, resource);
    }

    // Helpers
    private getWorkspaceRoot(): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder open');
        }
        return workspaceFolder.uri.fsPath;
    }

    shutdown(): void {
        this.resources.clear();
        this.tools.clear();
    }

    getTools(): MCPTool[] {
        return Array.from(this.tools.values());
    }
}
