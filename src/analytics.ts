// Lightweight GA4 Measurement Protocol client for Chrome MV3 extensions.
//
// Why Measurement Protocol and not gtag.js?
// - MV3 forbids loading remote scripts (gtag.js would be rejected by the
//   Chrome Web Store).
// - Service workers have no <head> to inject scripts into.
// - Measurement Protocol is a plain HTTPS POST, so it works everywhere.
//
// Storage keys used:
//   analyticsEnabled  boolean   user opt-in flag (default: false)
//   ga4MeasurementId  string    "G-XXXXXXXXXX"
//   ga4ApiSecret      string    the API secret generated in GA4 Admin
//   ga4ClientId       string    anonymous UUID, generated once per install
//
// IMPORTANT: this module never logs URLs of the pages the user visits,
// never logs Notion content, and never logs API keys. Only event names
// and non-PII categorical parameters are sent.

const GA_ENDPOINT = 'https://www.google-analytics.com/g/collect';
const MP_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

export interface AnalyticsConfig {
    enabled: boolean;
    measurementId: string;
    apiSecret: string;
    clientId: string;
}

/**
 * Generates a RFC4122 v4 UUID. Uses crypto.randomUUID() when available
 * (MV3 service workers do expose it) and falls back to a manual builder.
 */
const generateClientId = (): string => {
    try {
        if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
            return crypto.randomUUID();
        }
    } catch {
        // fall through
    }
    const bytes = new Uint8Array(16);
    (crypto as Crypto).getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * Reads the analytics configuration from chrome.storage.local.
 * Guarantees a stable clientId by generating and persisting one on first read.
 */
export const getAnalyticsConfig = (): Promise<AnalyticsConfig> => {
    return new Promise((resolve) => {
        chrome.storage.local.get(
            ['analyticsEnabled', 'ga4MeasurementId', 'ga4ApiSecret', 'ga4ClientId'],
            (store) => {
                let clientId = store.ga4ClientId as string | undefined;
                if (!clientId) {
                    clientId = generateClientId();
                    chrome.storage.local.set({ ga4ClientId: clientId });
                }
                resolve({
                    enabled: !!store.analyticsEnabled,
                    measurementId: String(store.ga4MeasurementId || ''),
                    apiSecret: String(store.ga4ApiSecret || ''),
                    clientId,
                });
            }
        );
    });
};

/**
 * Sends a single event to GA4 via the Measurement Protocol.
 * Silently returns false (without throwing) when analytics is disabled,
 * keys are missing, or the request fails — telemetry must never break the app.
 *
 * @param name   GA4 event name (snake_case, <=40 chars, must match [a-z_][a-z0-9_]*)
 * @param params Optional event parameters. Keep them categorical; do NOT pass URLs,
 *               page titles, note contents, or anything that could identify a user.
 */
export const trackEvent = async (
    name: string,
    params: Record<string, string | number | boolean> = {}
): Promise<boolean> => {
    try {
        const cfg = await getAnalyticsConfig();
        if (!cfg.enabled || !cfg.measurementId || !cfg.apiSecret) {
            return false;
        }

        const url = `${MP_ENDPOINT}?measurement_id=${encodeURIComponent(cfg.measurementId)}&api_secret=${encodeURIComponent(cfg.apiSecret)}`;
        const body = {
            client_id: cfg.clientId,
            non_personalized_ads: true,
            events: [{ name, params }],
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            // keepalive helps when the service worker is about to be suspended
            keepalive: true,
        });
        return res.ok;
    } catch (err) {
        console.debug('[analytics] trackEvent failed (ignored):', err);
        return false;
    }
};

// Re-exported so UI code can reference a single source of truth for endpoints
export const ANALYTICS_ENDPOINTS = { GA_ENDPOINT, MP_ENDPOINT };
