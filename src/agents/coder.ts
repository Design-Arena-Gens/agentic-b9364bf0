import { RAGSystem } from '../rag/system';
import { FileManager } from '../filesystem/manager';
import Anthropic from '@anthropic-ai/sdk';

export class CoderAgent {
    private client: Anthropic;

    constructor(
        private ragSystem: RAGSystem,
        private fileManager: FileManager
    ) {
        this.client = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY || ''
        });
    }

    async generateCode(
        taskDescription: string,
        plan: string[]
    ): Promise<Map<string, string>> {
        const codeFiles = new Map<string, string>();

        for (const step of plan) {
            // Get relevant context
            const context = await this.ragSystem.getRelevantContext(step);

            // Extract file path from step
            const fileMatch = step.match(/in ([a-zA-Z0-9/_.-]+\.[a-zA-Z]+)/);
            const filePath = fileMatch ? fileMatch[1] : this.inferFilePath(step);

            // Check if file exists
            const existingContent = await this.fileManager.readFile(filePath);

            const prompt = existingContent
                ? this.createEditPrompt(step, filePath, existingContent, context)
                : this.createNewFilePrompt(step, filePath, context);

            try {
                const response = await this.client.messages.create({
                    model: 'claude-3-5-sonnet-20241022',
                    max_tokens: 4000,
                    messages: [{ role: 'user', content: prompt }]
                });

                const content = response.content[0];
                if (content.type === 'text') {
                    const code = this.extractCode(content.text);
                    codeFiles.set(filePath, code);

                    // Write to file immediately
                    await this.fileManager.writeFile(filePath, code);
                }
            } catch (error) {
                console.error(`Error generating code for ${filePath}:`, error);
            }
        }

        return codeFiles;
    }

    async fixErrors(
        errors: string[],
        existingCode?: Map<string, string>
    ): Promise<Map<string, string>> {
        const fixes = new Map<string, string>();

        // Group errors by file
        const errorsByFile = this.groupErrorsByFile(errors);

        for (const [filePath, fileErrors] of errorsByFile.entries()) {
            const currentCode = existingCode?.get(filePath) ||
                               await this.fileManager.readFile(filePath);

            if (!currentCode) continue;

            const context = await this.ragSystem.getRelevantContext(fileErrors.join('\n'));

            const prompt = `You are a Coder Agent fixing errors in code.

File: ${filePath}

Current Code:
\`\`\`
${currentCode}
\`\`\`

Errors to Fix:
${fileErrors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Relevant Context:
${context}

Fix ALL the errors and return the complete corrected code.
Return ONLY the code, wrapped in triple backticks with the language specified.`;

            try {
                const response = await this.client.messages.create({
                    model: 'claude-3-5-sonnet-20241022',
                    max_tokens: 4000,
                    messages: [{ role: 'user', content: prompt }]
                });

                const content = response.content[0];
                if (content.type === 'text') {
                    const fixedCode = this.extractCode(content.text);
                    fixes.set(filePath, fixedCode);
                }
            } catch (error) {
                console.error(`Error fixing ${filePath}:`, error);
            }
        }

        return fixes;
    }

    private createNewFilePrompt(step: string, filePath: string, context: string): string {
        return `You are a Coder Agent implementing a new feature.

Task: ${step}
File: ${filePath}

Relevant Project Context:
${context}

Implement this step completely. Write production-ready, clean, and well-documented code.
Return ONLY the code, wrapped in triple backticks with the language specified.`;
    }

    private createEditPrompt(
        step: string,
        filePath: string,
        existingContent: string,
        context: string
    ): string {
        return `You are a Coder Agent modifying existing code.

Task: ${step}
File: ${filePath}

Existing Code:
\`\`\`
${existingContent}
\`\`\`

Relevant Project Context:
${context}

Modify the code to implement the task. Return the COMPLETE modified file.
Return ONLY the code, wrapped in triple backticks with the language specified.`;
    }

    private extractCode(text: string): string {
        const codeBlockMatch = text.match(/```[\w]*\n([\s\S]*?)```/);
        if (codeBlockMatch) {
            return codeBlockMatch[1].trim();
        }
        return text.trim();
    }

    private inferFilePath(step: string): string {
        const lower = step.toLowerCase();

        if (lower.includes('test')) return 'tests/test.ts';
        if (lower.includes('api') || lower.includes('route')) return 'src/api/routes.ts';
        if (lower.includes('model') || lower.includes('schema')) return 'src/models/index.ts';
        if (lower.includes('component')) return 'src/components/Component.tsx';
        if (lower.includes('util') || lower.includes('helper')) return 'src/utils/helpers.ts';

        return 'src/index.ts';
    }

    private groupErrorsByFile(errors: string[]): Map<string, string[]> {
        const grouped = new Map<string, string[]>();

        for (const error of errors) {
            // Try to extract file path from error message
            const fileMatch = error.match(/([a-zA-Z0-9/_.-]+\.[a-zA-Z]+)/);
            const filePath = fileMatch ? fileMatch[1] : 'unknown';

            if (!grouped.has(filePath)) {
                grouped.set(filePath, []);
            }
            grouped.get(filePath)?.push(error);
        }

        return grouped;
    }
}
