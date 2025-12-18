import { MCPServer } from '../mcp/server';
import { RAGSystem } from '../rag/system';
import { FileManager } from '../filesystem/manager';
import { TerminalManager } from '../terminal/manager';
import { ManagerAgent } from './manager';
import { CoderAgent } from './coder';
import { ReviewerAgent } from './reviewer';

export interface AgentTask {
    id: string;
    description: string;
    status: 'planning' | 'coding' | 'reviewing' | 'executing' | 'completed' | 'failed';
    plan?: string[];
    code?: Map<string, string>;
    errors?: string[];
}

export class AgentOrchestrator {
    private manager: ManagerAgent;
    private coder: CoderAgent;
    private reviewer: ReviewerAgent;
    private currentTask?: AgentTask;
    private isRunning: boolean = false;

    constructor(
        private mcpServer: MCPServer,
        private ragSystem: RAGSystem,
        private fileManager: FileManager,
        private terminalManager: TerminalManager
    ) {
        this.manager = new ManagerAgent(ragSystem);
        this.coder = new CoderAgent(ragSystem, fileManager);
        this.reviewer = new ReviewerAgent(ragSystem);
    }

    async executeTask(description: string): Promise<void> {
        if (this.isRunning) {
            throw new Error('Another task is already running');
        }

        this.isRunning = true;
        this.currentTask = {
            id: Date.now().toString(),
            description,
            status: 'planning'
        };

        try {
            // Phase 1: Planning (Manager Agent)
            console.log('🎯 Manager Agent: Planning task...');
            const plan = await this.manager.createPlan(description);
            this.currentTask.plan = plan;
            this.currentTask.status = 'coding';

            // Phase 2: Coding (Coder Agent)
            console.log('💻 Coder Agent: Writing code...');
            const codeFiles = await this.coder.generateCode(description, plan);
            this.currentTask.code = codeFiles;
            this.currentTask.status = 'reviewing';

            // Phase 3: Review (Reviewer Agent)
            console.log('🔍 Reviewer Agent: Reviewing code...');
            const reviewResult = await this.reviewer.reviewCode(codeFiles);

            if (reviewResult.hasErrors) {
                console.log('⚠️  Errors found, entering self-healing loop...');
                await this.selfHealingLoop(reviewResult.errors || []);
            }

            // Phase 4: Execution with self-healing
            this.currentTask.status = 'executing';
            await this.executeWithSelfHealing();

            this.currentTask.status = 'completed';
            console.log('✅ Task completed successfully!');
        } catch (error) {
            this.currentTask.status = 'failed';
            this.currentTask.errors = [error instanceof Error ? error.message : String(error)];
            console.error('❌ Task failed:', error);
            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    private async selfHealingLoop(errors: string[]): Promise<void> {
        const maxAttempts = 5;
        let attempts = 0;

        while (attempts < maxAttempts && errors.length > 0) {
            attempts++;
            console.log(`🔧 Self-healing attempt ${attempts}/${maxAttempts}...`);

            // Coder fixes the errors
            const fixes = await this.coder.fixErrors(errors, this.currentTask?.code);

            // Apply fixes
            if (fixes) {
                for (const [filePath, content] of fixes.entries()) {
                    await this.fileManager.writeFile(filePath, content);
                }
            }

            // Re-review
            const reviewResult = await this.reviewer.reviewCode(fixes || new Map());

            if (!reviewResult.hasErrors) {
                console.log('✅ Self-healing successful!');
                break;
            }

            errors = reviewResult.errors || [];
        }

        if (errors.length > 0) {
            throw new Error(`Failed to fix errors after ${maxAttempts} attempts`);
        }
    }

    private async executeWithSelfHealing(): Promise<void> {
        const maxExecutionAttempts = 3;
        let executionAttempts = 0;

        while (executionAttempts < maxExecutionAttempts) {
            executionAttempts++;
            console.log(`🚀 Executing code (attempt ${executionAttempts})...`);

            try {
                // Detect project type and run appropriate command
                const projectType = await this.fileManager.detectProjectType();
                let command: string;

                switch (projectType) {
                    case 'node':
                        command = 'npm run build && npm test';
                        break;
                    case 'python':
                        command = 'python -m pytest';
                        break;
                    case 'go':
                        command = 'go build && go test ./...';
                        break;
                    default:
                        command = 'echo "No build command detected"';
                }

                const result = await this.terminalManager.executeCommand(command);

                if (result.exitCode === 0) {
                    console.log('✅ Execution successful!');
                    return;
                }

                // Parse errors from terminal output
                const errors = this.parseExecutionErrors(result.stderr);

                if (errors.length > 0) {
                    console.log('⚠️  Execution errors detected, fixing...');
                    await this.selfHealingLoop(errors);
                } else {
                    throw new Error('Execution failed with no parseable errors');
                }
            } catch (error) {
                if (executionAttempts >= maxExecutionAttempts) {
                    throw error;
                }
                console.log(`⚠️  Execution attempt ${executionAttempts} failed, retrying...`);
            }
        }
    }

    private parseExecutionErrors(stderr: string): string[] {
        const errors: string[] = [];
        const lines = stderr.split('\n');

        for (const line of lines) {
            if (line.includes('Error') || line.includes('ERROR') ||
                line.includes('Exception') || line.includes('Failed')) {
                errors.push(line.trim());
            }
        }

        return errors;
    }

    stop(): void {
        this.isRunning = false;
        console.log('🛑 Orchestrator stopped');
    }

    getStatus(): AgentTask | undefined {
        return this.currentTask;
    }
}
