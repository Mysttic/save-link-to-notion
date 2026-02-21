console.log('Save Link to Notion: Content Script Loaded');

// Zbieranie podstawowych metadanych o stronie
export const getPageMetadata = () => {
    const getMetaContent = (name: string): string => {
        const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
        return el ? el.getAttribute('content') || '' : '';
    };

    return {
        title: document.title,
        url: window.location.href,
        description: getMetaContent('description') || getMetaContent('og:description'),
        image: getMetaContent('image') || getMetaContent('og:image'),
        type: getMetaContent('og:type'),
        selectedText: window.getSelection()?.toString() || ''
    };
};

export { };
