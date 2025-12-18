import * as vscode from 'vscode';
import { AgentOrchestrator } from '../agents/orchestrator';

export class UIProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly orchestrator: AgentOrchestrator
    ) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken
    ): void | Thenable<void> {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent(webviewView.webview);

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'startTask':
                    await this.handleStartTask(message.task);
                    break;
                case 'stopTask':
                    this.orchestrator.stop();
                    break;
                case 'getStatus':
                    this.sendStatus();
                    break;
            }
        });

        // Send initial status
        this.sendStatus();
    }

    private async handleStartTask(task: string): Promise<void> {
        try {
            this.sendMessage({ type: 'taskStarted' });
            await this.orchestrator.executeTask(task);
            this.sendMessage({ type: 'taskCompleted' });
        } catch (error) {
            this.sendMessage({
                type: 'taskError',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private sendStatus(): void {
        const status = this.orchestrator.getStatus();
        this.sendMessage({ type: 'status', status });
    }

    private sendMessage(message: any): void {
        this.view?.webview.postMessage(message);
    }

    private getHtmlContent(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Autonomous Architect</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }

        .header {
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .header h1 {
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 5px;
        }

        .header p {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .input-section {
            margin-bottom: 20px;
        }

        .task-input {
            width: 100%;
            padding: 10px;
            margin-bottom: 10px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 13px;
            resize: vertical;
            min-height: 80px;
        }

        .task-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        .button {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            margin-right: 8px;
        }

        .button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .status-section {
            margin-top: 20px;
            padding: 15px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
        }

        .status-title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .status-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
        }

        .status-badge.planning {
            background: #0078d4;
            color: white;
        }

        .status-badge.coding {
            background: #8b5cf6;
            color: white;
        }

        .status-badge.reviewing {
            background: #f59e0b;
            color: white;
        }

        .status-badge.executing {
            background: #10b981;
            color: white;
        }

        .status-badge.completed {
            background: #22c55e;
            color: white;
        }

        .status-badge.failed {
            background: #ef4444;
            color: white;
        }

        .plan-list {
            list-style: none;
            margin-top: 10px;
        }

        .plan-item {
            padding: 8px 0;
            padding-left: 20px;
            position: relative;
            font-size: 13px;
            border-left: 2px solid var(--vscode-panel-border);
            margin-bottom: 4px;
        }

        .plan-item:before {
            content: '→';
            position: absolute;
            left: 5px;
            color: var(--vscode-descriptionForeground);
        }

        .error-list {
            margin-top: 10px;
            padding: 10px;
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 4px;
        }

        .error-item {
            font-size: 12px;
            padding: 4px 0;
            color: var(--vscode-errorForeground);
        }

        .info-section {
            margin-top: 20px;
            padding: 12px;
            background: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textLink-foreground);
            border-radius: 4px;
        }

        .info-section h3 {
            font-size: 13px;
            margin-bottom: 8px;
        }

        .info-section ul {
            list-style-position: inside;
            font-size: 12px;
            line-height: 1.6;
        }

        .spinner {
            display: inline-block;
            width: 14px;
            height: 14px;
            border: 2px solid var(--vscode-foreground);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .hidden {
            display: none;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🤖 Autonomous Software Architect</h1>
        <p>Multi-Agent System with Self-Healing Capabilities</p>
    </div>

    <div class="input-section">
        <textarea
            id="taskInput"
            class="task-input"
            placeholder="Describe what you want to build...&#10;&#10;Example: Create a REST API with user authentication and CRUD operations"
        ></textarea>
        <button id="startBtn" class="button">Start Building</button>
        <button id="stopBtn" class="button secondary" disabled>Stop</button>
    </div>

    <div id="statusSection" class="status-section hidden">
        <div class="status-title">
            <span id="statusSpinner" class="spinner hidden"></span>
            <span>Status:</span>
            <span id="statusBadge" class="status-badge">Idle</span>
        </div>
        <div id="taskDescription"></div>
        <ul id="planList" class="plan-list hidden"></ul>
        <div id="errorList" class="error-list hidden"></div>
    </div>

    <div class="info-section">
        <h3>🎯 How It Works:</h3>
        <ul>
            <li><strong>Manager Agent:</strong> Creates implementation plan</li>
            <li><strong>Coder Agent:</strong> Writes code autonomously</li>
            <li><strong>Reviewer Agent:</strong> Checks for errors</li>
            <li><strong>Self-Healing:</strong> Auto-fixes errors by re-executing</li>
            <li><strong>RAG Context:</strong> Uses your project's code for reference</li>
        </ul>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        const taskInput = document.getElementById('taskInput');
        const startBtn = document.getElementById('startBtn');
        const stopBtn = document.getElementById('stopBtn');
        const statusSection = document.getElementById('statusSection');
        const statusBadge = document.getElementById('statusBadge');
        const statusSpinner = document.getElementById('statusSpinner');
        const taskDescription = document.getElementById('taskDescription');
        const planList = document.getElementById('planList');
        const errorList = document.getElementById('errorList');

        startBtn.addEventListener('click', () => {
            const task = taskInput.value.trim();
            if (task) {
                vscode.postMessage({ type: 'startTask', task });
                startBtn.disabled = true;
                stopBtn.disabled = false;
            }
        });

        stopBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'stopTask' });
            startBtn.disabled = false;
            stopBtn.disabled = true;
        });

        window.addEventListener('message', (event) => {
            const message = event.data;

            switch (message.type) {
                case 'status':
                    updateStatus(message.status);
                    break;
                case 'taskStarted':
                    statusSection.classList.remove('hidden');
                    statusSpinner.classList.remove('hidden');
                    break;
                case 'taskCompleted':
                    statusSpinner.classList.add('hidden');
                    startBtn.disabled = false;
                    stopBtn.disabled = true;
                    break;
                case 'taskError':
                    statusSpinner.classList.add('hidden');
                    startBtn.disabled = false;
                    stopBtn.disabled = true;
                    alert('Error: ' + message.error);
                    break;
            }
        });

        function updateStatus(status) {
            if (!status) return;

            statusSection.classList.remove('hidden');
            statusBadge.textContent = status.status;
            statusBadge.className = 'status-badge ' + status.status;

            taskDescription.innerHTML = '<strong>Task:</strong> ' + status.description;

            if (status.plan && status.plan.length > 0) {
                planList.classList.remove('hidden');
                planList.innerHTML = status.plan
                    .map(step => '<li class="plan-item">' + step + '</li>')
                    .join('');
            } else {
                planList.classList.add('hidden');
            }

            if (status.errors && status.errors.length > 0) {
                errorList.classList.remove('hidden');
                errorList.innerHTML = '<strong>Errors:</strong><br>' +
                    status.errors
                        .map(error => '<div class="error-item">' + error + '</div>')
                        .join('');
            } else {
                errorList.classList.add('hidden');
            }
        }

        // Request initial status
        vscode.postMessage({ type: 'getStatus' });
    </script>
</body>
</html>`;
    }
}
