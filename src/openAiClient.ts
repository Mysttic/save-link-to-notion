// Chat completions via OpenRouter.

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 60_000;

export class AiApiError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'AiApiError';
        this.status = status;
    }
}

export const askAi = async (
    apiKey: string,
    model: string,
    messages: ChatMessage[],
    options: { timeoutMs?: number; maxTokens?: number } = {}
): Promise<string> => {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, maxTokens = 1000 } = options;
    // Without this a stalled request leaves the chat spinner running forever.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
        response = await fetch(ENDPOINT, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://github.com/Mysttic/save-link-to-notion',
                'X-Title': 'Save Link to Notion',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: 0.7,
                max_tokens: maxTokens,
            }),
        });
    } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
            throw new AiApiError(0, `AI request timed out after ${timeoutMs / 1000}s.`);
        }
        throw new AiApiError(0, 'No connection to the AI provider (OpenRouter).');
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        const rawBody = await response.text();
        let message = '';
        try {
            message = JSON.parse(rawBody)?.error?.message || '';
        } catch {
            message = rawBody.slice(0, 200);
        }
        if (response.status === 401) {
            throw new AiApiError(401, 'Invalid OpenRouter API key. Update it in the settings.');
        }
        if (response.status === 402) {
            throw new AiApiError(402, 'OpenRouter reports insufficient credits for this model.');
        }
        throw new AiApiError(
            response.status,
            message || `OpenRouter error ${response.status}.`
        );
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string') {
        throw new AiApiError(response.status, 'The AI provider returned an empty response.');
    }
    return reply;
};
