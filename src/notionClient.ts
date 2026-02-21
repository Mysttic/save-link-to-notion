// Notion API Helper for Chrome Extension (Service Worker context)

const NOTION_VER = '2022-06-28';

export interface NotionPageData {
    url: string;
    title: string;
    description: string;
    tags: string[];
    sessionId?: string;
    highlights?: string;
}

const buildProperties = (data: NotionPageData) => {
    const props: any = {
        "Title": { title: [{ text: { content: data.title || data.url } }] },
        "Link": { url: data.url },
        "Status": { status: { name: "New" } }
    };

    if (data.description) {
        props["Description"] = { rich_text: [{ text: { content: data.description } }] };
    }

    if (data.tags && data.tags.length > 0) {
        props["Tags"] = { multi_select: data.tags.map(t => ({ name: t })) };
    }

    if (data.sessionId) {
        props["Session ID"] = { rich_text: [{ text: { content: data.sessionId } }] };
    }

    if (data.highlights) {
        props["Highlights"] = { rich_text: [{ text: { content: data.highlights } }] };
    }
    return props;
};

export const savePageToNotion = async (
    apiKey: string,
    databaseId: string,
    data: NotionPageData
) => {
    const url = 'https://api.notion.com/v1/pages';
    const body = {
        parent: { database_id: databaseId },
        properties: buildProperties(data)
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Notion-Version': NOTION_VER,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    const responseText = await response.text();
    console.log("Notion API raw response:", responseText);

    if (!response.ok) {
        throw new Error(`Notion API error: ${response.status} ${responseText}`);
    }

    return JSON.parse(responseText);
};

export const updatePageToNotion = async (
    apiKey: string,
    pageId: string,
    data: NotionPageData
) => {
    const url = `https://api.notion.com/v1/pages/${pageId}`;
    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Notion-Version': NOTION_VER,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ properties: buildProperties(data) })
    });

    const responseText = await response.text();
    console.log("Notion API raw update response:", responseText);

    if (!response.ok) {
        throw new Error(`Notion API error: ${response.status} ${responseText}`);
    }

    return JSON.parse(responseText);
};

export const checkIfPageSaved = async (
    apiKey: string,
    databaseId: string,
    url: string
): Promise<{ exists: boolean, summary: string, pageId: string | null }> => {
    const queryUrl = `https://api.notion.com/v1/databases/${databaseId}/query`;

    const response = await fetch(queryUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Notion-Version': NOTION_VER,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            filter: {
                property: "Link",
                url: {
                    equals: url
                }
            }
        })
    });

    if (!response.ok) {
        return { exists: false, summary: '', pageId: null };
    }

    const data = await response.json();
    if (data.results && data.results.length > 0) {
        const page = data.results[0];
        const desc = page.properties?.Description?.rich_text?.[0]?.plain_text || '';
        const date = page.created_time ? new Date(page.created_time).toLocaleDateString() : '';
        const summary = `Zapisano ${date}${desc ? ` z notatką: "${desc}"` : '.'}`;
        return { exists: true, summary, pageId: page.id };
    }

    return { exists: false, summary: '', pageId: null };
};

export const addCommentToPage = async (
    apiKey: string,
    pageId: string,
    commentText: string
) => {
    const url = 'https://api.notion.com/v1/comments';

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Notion-Version': NOTION_VER,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            parent: {
                page_id: pageId
            },
            rich_text: [
                {
                    text: {
                        content: commentText
                    }
                }
            ]
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Notion Comment error details:", errorText);
        throw new Error(`Notion API error writing comment: ${response.status} ${errorText}`);
    }

    return await response.json();
};

export const appendImageBlocks = async (
    apiKey: string,
    pageId: string,
    imageUrls: string[]
) => {
    const url = `https://api.notion.com/v1/blocks/${pageId}/children`;

    // Construct block array
    const imageBlocks = imageUrls.map(imgUrl => ({
        object: 'block',
        type: 'image',
        image: {
            type: 'external',
            external: {
                url: imgUrl
            }
        }
    }));

    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Notion-Version': NOTION_VER,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            children: imageBlocks
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Notion Block append error:", errorText);
        throw new Error(`Notion API error appending blocks: ${response.status} ${errorText}`);
    }

    return await response.json();
};

export const appendTextBlocks = async (
    apiKey: string,
    pageId: string,
    text: string
) => {
    const url = `https://api.notion.com/v1/blocks/${pageId}/children`;

    // Construct block array
    const paragraphs = text.split('\n').filter(p => p.trim() !== '');
    const textBlocks = paragraphs.map(p => ({
        object: 'block',
        type: 'paragraph',
        paragraph: {
            rich_text: [
                {
                    text: { content: p }
                }
            ]
        }
    }));

    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Notion-Version': NOTION_VER,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            children: textBlocks
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Notion Text Block append error:", errorText);
        throw new Error(`Notion API error appending text blocks: ${response.status} ${errorText}`);
    }

    return await response.json();
};
