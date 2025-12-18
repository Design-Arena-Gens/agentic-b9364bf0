import * as vscode from 'vscode';
import { AgentOrchestrator } from './agents/orchestrator';
import { MCPServer } from './mcp/server';
import { RAGSystem } from './rag/system';
import { FileManager } from './filesystem/manager';
import { TerminalManager } from './terminal/manager';
import { UIProvider } from './ui/provider';

let orchestrator: AgentOrchestrator | undefined;
let mcpServer: MCPServer | undefined;
let ragSystem: RAGSystem | undefined;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Autonomous Software Architect is now active!');

    // Initialize core systems
    mcpServer = new MCPServer();
    ragSystem = new RAGSystem(context);
    const fileManager = new FileManager();
    const terminalManager = new TerminalManager();

    orchestrator = new AgentOrchestrator(
        mcpServer,
        ragSystem,
        fileManager,
        terminalManager
    );

    // Register UI Provider
    const uiProvider = new UIProvider(context.extensionUri, orchestrator);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('autonomous-architect.panel', uiProvider)
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('autonomous-architect.start', async () => {
            const task = await vscode.window.showInputBox({
                prompt: 'What should the autonomous architect build?',
                placeHolder: 'e.g., Create a REST API with authentication'
            });

            if (task && orchestrator) {
                vscode.window.showInformationMessage('Autonomous Architect started working...');
                await orchestrator.executeTask(task);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('autonomous-architect.stop', () => {
            if (orchestrator) {
                orchestrator.stop();
                vscode.window.showInformationMessage('Autonomous Architect stopped.');
            }
        })
    );

    // Initialize RAG system with workspace
    if (vscode.workspace.workspaceFolders) {
        await ragSystem.indexWorkspace(vscode.workspace.workspaceFolders[0].uri.fsPath);
    }
}

export function deactivate() {
    if (orchestrator) {
        orchestrator.stop();
    }
    if (mcpServer) {
        mcpServer.shutdown();
    }
}
