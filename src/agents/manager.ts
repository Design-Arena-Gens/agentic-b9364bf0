import { RAGSystem } from '../rag/system';
import Anthropic from '@anthropic-ai/sdk';

export class ManagerAgent {
    private client: Anthropic;

    constructor(private ragSystem: RAGSystem) {
        this.client = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY || ''
        });
    }

    async createPlan(taskDescription: string): Promise<string[]> {
        // Get relevant context from RAG
        const context = await this.ragSystem.getRelevantContext(taskDescription);

        const prompt = `You are a Manager Agent responsible for creating detailed implementation plans.

Task: ${taskDescription}

Relevant Project Context:
${context}

Create a detailed, step-by-step implementation plan. Each step should be:
1. Specific and actionable
2. Focused on a single file or component
3. Include dependencies between steps

Return the plan as a JSON array of strings, where each string is one step.
Example: ["Create database schema in models/user.ts", "Implement authentication middleware", "Add API routes"]

Return ONLY the JSON array, no additional text.`;

        try {
            const response = await this.client.messages.create({
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 2000,
                messages: [{ role: 'user', content: prompt }]
            });

            const content = response.content[0];
            if (content.type === 'text') {
                const planText = content.text.trim();
                const jsonMatch = planText.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
                // Fallback: split by newlines
                return planText.split('\n')
                    .map(line => line.trim())
                    .filter(line => line && !line.startsWith('[') && !line.startsWith(']'));
            }

            return ['Implement requested feature'];
        } catch (error) {
            console.error('Manager Agent error:', error);
            return ['Implement requested feature'];
        }
    }

    async decomposePlan(plan: string[]): Promise<Map<string, string[]>> {
        const decomposition = new Map<string, string[]>();

        for (const step of plan) {
            // Extract file path from step
            const fileMatch = step.match(/in ([a-zA-Z0-9/_.-]+\.[a-zA-Z]+)/);
            const filePath = fileMatch ? fileMatch[1] : `step_${plan.indexOf(step)}.ts`;

            if (!decomposition.has(filePath)) {
                decomposition.set(filePath, []);
            }
            decomposition.get(filePath)?.push(step);
        }

        return decomposition;
    }
}
