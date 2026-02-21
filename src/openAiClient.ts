export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export const askOpenAI = async (
    apiKey: string,
    model: string,
    messages: ChatMessage[]
) => {
    const url = 'https://openrouter.ai/api/v1/chat/completions';

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://savelinktonotion.com', // Optional but recommended by OpenRouter
            'X-Title': 'Save Link to Notion Plugin', // Optional
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: model,
            messages: messages,
            temperature: 0.7,
            max_tokens: 1000,
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    if (data.choices && data.choices.length > 0) {
        return data.choices[0].message.content;
    }

    throw new Error('Invalid response from AI');
};
