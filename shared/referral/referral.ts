/**
 * Referral block on the thank-you page: a shareable discount code and a link that
 * applies it automatically (Shopify's /discount/<code> route).
 *
 * The code itself is a normal code discount created in the admin or via the API
 * (see scripts/create-referral-code.graphql) — the extension only presents it.
 */

export interface ReferralConfig {
  version: 1;
  code: string;
  percentOff: number;
}

/** Codes are shown and shared as typed; only letters, digits, dash and underscore are allowed. */
const CODE = /^[A-Za-z0-9_-]{3,40}$/;

export function parseReferralConfig(raw: unknown): ReferralConfig | null {
  const data = typeof raw === 'string' ? safeJson(raw) : raw;
  if (typeof data !== 'object' || data === null) return null;
  const {version, code, percentOff} = data as Record<string, unknown>;
  if (version !== 1 || typeof code !== 'string' || !CODE.test(code)) return null;
  if (typeof percentOff !== 'number' || percentOff <= 0 || percentOff > 100) return null;
  return {version: 1, code, percentOff};
}

/** A link that opens the store with the code already applied, landing on the home page. */
export function shareUrl(storefrontUrl: string, code: string): string {
  const base = storefrontUrl.replace(/\/+$/, '');
  return `${base}/discount/${encodeURIComponent(code)}?redirect=%2F`;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
