import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { OpenAIEmbeddings } from '@langchain/openai';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { Document } from '@langchain/core/documents';

export interface CodeChunk {
    content: string;
    filePath: string;
    language: string;
    startLine: number;
    endLine: number;
    metadata?: Record<string, any>;
}

export class RAGSystem {
    private vectorStore?: MemoryVectorStore;
    private embeddings: OpenAIEmbeddings;
    private textSplitter: RecursiveCharacterTextSplitter;
    private indexed: boolean = false;
    private cache: Map<string, string> = new Map();

    constructor(private context: vscode.ExtensionContext) {
        // Initialize embeddings (falls back to mock if no API key)
        this.embeddings = new OpenAIEmbeddings({
            openAIApiKey: process.env.OPENAI_API_KEY || 'mock-key',
            modelName: 'text-embedding-3-small'
        });

        // Initialize text splitter for code
        this.textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
            separators: ['\n\n', '\nclass ', '\nfunction ', '\nconst ', '\nlet ', '\n', ' ']
        });
    }

    async indexWorkspace(workspacePath: string): Promise<void> {
        console.log('🔍 Starting RAG indexing...');

        const documents: Document[] = [];
        const codeFiles = await this.findCodeFiles(workspacePath);

        for (const filePath of codeFiles) {
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                const relativePath = path.relative(workspacePath, filePath);

                // Split content into chunks
                const chunks = await this.textSplitter.splitText(content);

                for (let i = 0; i < chunks.length; i++) {
                    documents.push(
                        new Document({
                            pageContent: chunks[i],
                            metadata: {
                                filePath: relativePath,
                                language: this.detectLanguage(filePath),
                                chunkIndex: i,
                                totalChunks: chunks.length
                            }
                        })
                    );
                }

                // Cache full file content
                this.cache.set(relativePath, content);
            } catch (error) {
                console.error(`Error indexing ${filePath}:`, error);
            }
        }

        console.log(`📚 Indexed ${documents.length} code chunks from ${codeFiles.length} files`);

        // Create vector store
        if (documents.length > 0) {
            try {
                this.vectorStore = await MemoryVectorStore.fromDocuments(
                    documents,
                    this.embeddings
                );
                this.indexed = true;
                console.log('✅ RAG indexing completed');
            } catch (error) {
                console.error('Error creating vector store:', error);
                // Fallback to cache-only mode
                this.indexed = false;
            }
        }
    }

    async getRelevantContext(query: string, topK: number = 5): Promise<string> {
        if (!this.indexed || !this.vectorStore) {
            // Fallback: return cached files
            return this.getFallbackContext();
        }

        try {
            const results = await this.vectorStore.similaritySearch(query, topK);

            if (results.length === 0) {
                return this.getFallbackContext();
            }

            const contextParts: string[] = [];

            for (const doc of results) {
                const filePath = doc.metadata.filePath;
                const language = doc.metadata.language;

                contextParts.push(
                    `File: ${filePath}\n\`\`\`${language}\n${doc.pageContent}\n\`\`\`\n`
                );
            }

            return contextParts.join('\n---\n\n');
        } catch (error) {
            console.error('Error getting relevant context:', error);
            return this.getFallbackContext();
        }
    }

    async getFileContext(filePath: string): Promise<string> {
        const content = this.cache.get(filePath);
        if (content) {
            return content;
        }

        // Try to read from disk
        try {
            const workspaceRoot = this.getWorkspaceRoot();
            const fullPath = path.join(workspaceRoot, filePath);
            const fileContent = await fs.readFile(fullPath, 'utf-8');
            this.cache.set(filePath, fileContent);
            return fileContent;
        } catch {
            return '';
        }
    }

    async searchCode(query: string): Promise<CodeChunk[]> {
        if (!this.indexed || !this.vectorStore) {
            return [];
        }

        try {
            const results = await this.vectorStore.similaritySearch(query, 10);

            return results.map(doc => ({
                content: doc.pageContent,
                filePath: doc.metadata.filePath,
                language: doc.metadata.language,
                startLine: 0,
                endLine: 0,
                metadata: doc.metadata
            }));
        } catch (error) {
            console.error('Error searching code:', error);
            return [];
        }
    }

    async reindexFile(filePath: string): Promise<void> {
        const workspaceRoot = this.getWorkspaceRoot();
        const fullPath = path.join(workspaceRoot, filePath);

        try {
            const content = await fs.readFile(fullPath, 'utf-8');
            this.cache.set(filePath, content);

            if (this.vectorStore) {
                const chunks = await this.textSplitter.splitText(content);
                const documents = chunks.map((chunk, i) =>
                    new Document({
                        pageContent: chunk,
                        metadata: {
                            filePath,
                            language: this.detectLanguage(fullPath),
                            chunkIndex: i,
                            totalChunks: chunks.length
                        }
                    })
                );

                // Add to vector store
                await this.vectorStore.addDocuments(documents);
            }
        } catch (error) {
            console.error(`Error reindexing ${filePath}:`, error);
        }
    }

    private async findCodeFiles(workspacePath: string): Promise<string[]> {
        const files: string[] = [];
        const excludeDirs = ['node_modules', '.git', 'dist', 'build', '.vscode', 'coverage'];
        const includeExts = ['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.cpp', '.c'];

        const scan = async (dir: string) => {
            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);

                    if (entry.isDirectory()) {
                        if (!excludeDirs.includes(entry.name)) {
                            await scan(fullPath);
                        }
                    } else if (entry.isFile()) {
                        const ext = path.extname(entry.name);
                        if (includeExts.includes(ext)) {
                            files.push(fullPath);
                        }
                    }
                }
            } catch (error) {
                console.error(`Error scanning ${dir}:`, error);
            }
        };

        await scan(workspacePath);
        return files;
    }

    private detectLanguage(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const languageMap: Record<string, string> = {
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.py': 'python',
            '.go': 'go',
            '.rs': 'rust',
            '.java': 'java',
            '.cpp': 'cpp',
            '.c': 'c'
        };
        return languageMap[ext] || 'plaintext';
    }

    private getFallbackContext(): string {
        // Return a summary of cached files
        const files = Array.from(this.cache.keys()).slice(0, 3);

        if (files.length === 0) {
            return 'No context available';
        }

        const contextParts: string[] = [];
        for (const file of files) {
            const content = this.cache.get(file);
            if (content) {
                const preview = content.slice(0, 500);
                contextParts.push(`File: ${file}\n\`\`\`\n${preview}\n...\n\`\`\``);
            }
        }

        return contextParts.join('\n\n');
    }

    private getWorkspaceRoot(): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder open');
        }
        return workspaceFolder.uri.fsPath;
    }

    isIndexed(): boolean {
        return this.indexed;
    }

    getCachedFiles(): string[] {
        return Array.from(this.cache.keys());
    }

    clear(): void {
        this.vectorStore = undefined;
        this.cache.clear();
        this.indexed = false;
    }
}
