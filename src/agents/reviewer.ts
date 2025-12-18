import { RAGSystem } from '../rag/system';
import Anthropic from '@anthropic-ai/sdk';

export interface ReviewResult {
    hasErrors: boolean;
    errors?: string[];
    warnings?: string[];
    suggestions?: string[];
}

export class ReviewerAgent {
    private client: Anthropic;

    constructor(private ragSystem: RAGSystem) {
        this.client = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY || ''
        });
    }

    async reviewCode(codeFiles: Map<string, string>): Promise<ReviewResult> {
        const allErrors: string[] = [];
        const allWarnings: string[] = [];
        const allSuggestions: string[] = [];

        for (const [filePath, code] of codeFiles.entries()) {
            const result = await this.reviewFile(filePath, code);

            if (result.errors) allErrors.push(...result.errors);
            if (result.warnings) allWarnings.push(...result.warnings);
            if (result.suggestions) allSuggestions.push(...result.suggestions);
        }

        return {
            hasErrors: allErrors.length > 0,
            errors: allErrors,
            warnings: allWarnings,
            suggestions: allSuggestions
        };
    }

    private async reviewFile(filePath: string, code: string): Promise<ReviewResult> {
        const context = await this.ragSystem.getRelevantContext(code);

        const prompt = `You are a Reviewer Agent performing code review.

File: ${filePath}

Code to Review:
\`\`\`
${code}
\`\`\`

Project Context:
${context}

Review this code for:
1. Syntax errors
2. Type errors
3. Logic errors
4. Security vulnerabilities
5. Performance issues
6. Best practices violations
7. Missing error handling
8. Inconsistent naming conventions

Return your review as a JSON object with this structure:
{
  "errors": ["Critical issues that will cause failures"],
  "warnings": ["Issues that should be fixed but won't break code"],
  "suggestions": ["Optional improvements"]
}

Return ONLY the JSON object, no additional text.`;

        try {
            const response = await this.client.messages.create({
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 2000,
                messages: [{ role: 'user', content: prompt }]
            });

            const content = response.content[0];
            if (content.type === 'text') {
                const jsonMatch = content.text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const result = JSON.parse(jsonMatch[0]);
                    return {
                        hasErrors: (result.errors?.length || 0) > 0,
                        errors: result.errors || [],
                        warnings: result.warnings || [],
                        suggestions: result.suggestions || []
                    };
                }
            }

            return { hasErrors: false };
        } catch (error) {
            console.error(`Error reviewing ${filePath}:`, error);
            return { hasErrors: false };
        }
    }

    async performStaticAnalysis(filePath: string, code: string): Promise<string[]> {
        const errors: string[] = [];

        // Basic static analysis checks
        const lines = code.split('\n');

        // Check for common issues
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;

            // Unclosed brackets
            const openBrackets = (line.match(/[{([]/g) || []).length;
            const closeBrackets = (line.match(/[}\])]/g) || []).length;
            if (openBrackets > closeBrackets) {
                errors.push(`${filePath}:${lineNum}: Possible unclosed bracket`);
            }

            // Console logs in production
            if (line.includes('console.log') || line.includes('console.error')) {
                errors.push(`${filePath}:${lineNum}: Console statement detected`);
            }

            // TODO comments
            if (line.includes('TODO') || line.includes('FIXME')) {
                errors.push(`${filePath}:${lineNum}: Unresolved TODO/FIXME`);
            }
        }

        return errors;
    }
}
