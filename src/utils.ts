/**
 * Uses Chrome's own favicon cache rather than a third-party service, so opening
 * the Saved list does not disclose the domains you bookmarked to anyone.
 */
export const faviconFor = (url: string): string => {
    try {
        new URL(url);
    } catch {
        return '';
    }
    if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return '';

    const favicon = new URL(chrome.runtime.getURL('/_favicon/'));
    favicon.searchParams.set('pageUrl', url);
    favicon.searchParams.set('size', '32');
    return favicon.toString();
};

export const formatDate = (iso: string): string => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
};

export const openUrl = (url: string) => {
    if (!url) return;
    if (typeof chrome !== 'undefined' && chrome.tabs) {
        void chrome.tabs.create({ url });
    } else {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
};
