import { useCallback, useState } from 'react';
import { sendMessage } from '../messages';
import {
    buildPageContextMessage,
    buildSystemPrompt,
    describeAction,
    parseAiReply,
    resolveImageIds,
} from '../aiActions';
import type { AiAction } from '../aiActions';
import type { ChatMessage } from '../openAiClient';
import type { PageMetadata } from '../types';

export interface PendingAction {
    action: AiAction;
    description: string;
}

/**
 * Chat state plus the approval gate for Notion writes. Page content reaches the
 * model as untrusted data, so an action it requests is only carried out after
 * the user confirms it.
 */
export const useAiChat = (pageData: PageMetadata | null, syncedPageId: string | null) => {
    // Only real conversation turns live here. The system prompt and the page
    // context are rebuilt at send time, which keeps them out of the transcript
    // the user sees and lets late-arriving metadata still reach the model.
    const [turns, setTurns] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [pending, setPending] = useState<PendingAction | null>(null);

    const appendAssistant = useCallback((content: string) => {
        setTurns((previous) => [...previous, { role: 'assistant', content }]);
    }, []);

    const send = useCallback(
        async (input: string) => {
            if (!input.trim() || loading) return;

            const nextTurns: ChatMessage[] = [...turns, { role: 'user', content: input }];
            setTurns(nextTurns);
            setLoading(true);

            const primer = pageData
                ? [buildSystemPrompt(), buildPageContextMessage(pageData)]
                : [buildSystemPrompt()];

            const response = await sendMessage({
                type: 'ASK_AI',
                messages: [...primer, ...nextTurns],
            });
            setLoading(false);

            if (!response.success) {
                appendAssistant(`Error: ${response.error}`);
                return;
            }

            const parsed = parseAiReply(response.reply);
            if (parsed.text) appendAssistant(parsed.text);
            if (parsed.parseError) appendAssistant(`[System] ${parsed.parseError}`);

            if (!parsed.action) return;

            if (!syncedPageId) {
                appendAssistant(
                    '[System] Save this page to Notion first — there is no page to write to yet.'
                );
                return;
            }

            setPending({
                action: parsed.action,
                description: describeAction(parsed.action, pageData?.images ?? []),
            });
        },
        [appendAssistant, loading, pageData, syncedPageId, turns]
    );

    const approve = useCallback(async () => {
        if (!pending || !syncedPageId) return;
        const { action } = pending;
        setPending(null);

        if (action.type === 'append_images') {
            const urls = resolveImageIds(action.imageIds, pageData?.images ?? []);
            if (urls.length === 0) {
                appendAssistant('[System] None of the requested image IDs exist on this page.');
                return;
            }
            const response = await sendMessage({
                type: 'APPEND_IMAGE_BLOCKS',
                pageId: syncedPageId,
                urls,
            });
            appendAssistant(
                response.success
                    ? `[System] Added ${response.appended} image(s) to Notion.${
                          response.skipped
                              ? ` ${response.skipped} were rejected by Notion and skipped.`
                              : ''
                      }`
                    : `[System] Failed to add images: ${response.error}`
            );
            return;
        }

        const response = await sendMessage({
            type: 'APPEND_TEXT_BLOCKS',
            pageId: syncedPageId,
            text: action.text,
        });
        appendAssistant(
            response.success
                ? '[System] Added the text to Notion.'
                : `[System] Failed to add text: ${response.error}`
        );
    }, [appendAssistant, pageData, pending, syncedPageId]);

    const reject = useCallback(() => {
        setPending(null);
        appendAssistant('[System] Action declined — nothing was written to Notion.');
    }, [appendAssistant]);

    return { visibleMessages: turns, loading, pending, send, approve, reject };
};
