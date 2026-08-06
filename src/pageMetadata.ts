// Functions in this file are serialised and injected into the active tab via
// chrome.scripting.executeScript. They must stay self-contained: no imports, no
// references to module scope, otherwise the injected copy throws at runtime.

import type { PageMetadata } from './types';

export function collectPageMetadata(): PageMetadata {
    const getMetaContent = (name: string): string => {
        const el = document.querySelector(
            `meta[name="${name}"], meta[property="${name}"]`
        );
        return el ? el.getAttribute('content') || '' : '';
    };

    return {
        title: document.title,
        url: window.location.href,
        description: getMetaContent('description') || getMetaContent('og:description'),
        image: getMetaContent('image') || getMetaContent('og:image'),
        type: getMetaContent('og:type'),
        selectedText: window.getSelection()?.toString() || '',
        images: Array.from(document.images)
            .map((img) => img.src)
            .filter((src) => src && src.startsWith('http'))
            .slice(0, 15),
    };
}

/**
 * Extracts the readable part of the page as ready-to-send Notion blocks.
 * Heuristic on purpose: a full Readability port would have to be bundled as a
 * standalone IIFE, while this runs as a plain injected function.
 */
export function extractArticleBlocks(): unknown[] {
    const MAX_BLOCKS = 300;
    const CHUNK = 2000;
    const CONTENT_SELECTOR = 'h1,h2,h3,h4,p,li,blockquote,pre,img';
    const CHROME_SELECTOR = 'nav,header,footer,aside,form,script,style,noscript,figcaption';

    const toRichText = (text: string) => {
        const chunks: string[] = [];
        for (let i = 0; i < text.length && chunks.length < 100; i += CHUNK) {
            chunks.push(text.slice(i, i + CHUNK));
        }
        return chunks.map((content) => ({ text: { content } }));
    };

    const pickRoot = (): HTMLElement => {
        const candidates = Array.from(
            document.querySelectorAll<HTMLElement>(
                'article, main, [role="main"], .post-content, .entry-content, .article-body, #content'
            )
        );
        let best: HTMLElement | null = null;
        let bestLength = 0;
        for (const candidate of candidates) {
            const length = (candidate.innerText || '').trim().length;
            if (length > bestLength) {
                bestLength = length;
                best = candidate;
            }
        }
        return best && bestLength > 200 ? best : document.body;
    };

    const root = pickRoot();
    const blocks: unknown[] = [];

    for (const el of Array.from(root.querySelectorAll<HTMLElement>(CONTENT_SELECTOR))) {
        if (blocks.length >= MAX_BLOCKS) break;
        if (el.closest(CHROME_SELECTOR)) continue;

        const tag = el.tagName.toLowerCase();

        if (tag === 'img') {
            const src = (el as unknown as HTMLImageElement).currentSrc || (el as unknown as HTMLImageElement).src;
            if (src && /^https?:\/\//.test(src)) {
                blocks.push({
                    object: 'block',
                    type: 'image',
                    image: { type: 'external', external: { url: src } },
                });
            }
            continue;
        }

        // Skip nested text nodes (a <p> inside an <li>) so content is not duplicated.
        const enclosing = el.parentElement?.closest(CONTENT_SELECTOR);
        if (enclosing && root.contains(enclosing)) continue;

        const text = (el.innerText || '').trim();
        if (!text) continue;

        if (tag === 'pre') {
            blocks.push({
                object: 'block',
                type: 'code',
                code: { rich_text: toRichText(text), language: 'plain text' },
            });
            continue;
        }

        const type =
            tag === 'h1'
                ? 'heading_1'
                : tag === 'h2'
                  ? 'heading_2'
                  : tag === 'h3' || tag === 'h4'
                    ? 'heading_3'
                    : tag === 'li'
                      ? 'bulleted_list_item'
                      : tag === 'blockquote'
                        ? 'quote'
                        : 'paragraph';

        blocks.push({ object: 'block', type, [type]: { rich_text: toRichText(text) } });
    }

    return blocks;
}
