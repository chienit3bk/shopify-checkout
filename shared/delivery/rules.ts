/**
 * Delivery option rules: hide, rename and reorder shipping options by cart weight,
 * destination country and subtotal — e.g. "no Express over 1 kg", "US buyers see
 * carrier names", "Express first for US orders". Pure, shared by the
 * delivery-customization Function and unit tests.
 */

export type WeightUnit = 'GRAMS' | 'KILOGRAMS' | 'OUNCES' | 'POUNDS';

export interface RuleWhen {
  /** Cart weight at least this many kg. */
  minWeightKg?: number;
  /** Destination country codes (ISO 3166-1 alpha-2). */
  countries?: string[];
  /** Subtotal at least this much, in the cart currency. */
  minSubtotal?: number;
}

export type DeliveryRule =
  | {action: 'hide'; methods: string[]; when?: RuleWhen}
  | {action: 'rename'; methods: string[]; title: string; when?: RuleWhen}
  | {action: 'move'; methods: string[]; index: number; when?: RuleWhen};

export interface DeliveryRulesConfig {
  version: 1;
  rules: DeliveryRule[];
}

export interface DeliveryContext {
  weightKg: number;
  countryCode: string | null;
  subtotal: number;
}

export interface OptionLike {
  handle: string;
  title: string | null;
}

export type DeliveryOperation =
  | {type: 'hide'; handle: string}
  | {type: 'rename'; handle: string; title: string}
  | {type: 'move'; handle: string; index: number};

const TO_KG: Record<WeightUnit, number> = {GRAMS: 0.001, KILOGRAMS: 1, OUNCES: 0.0283495, POUNDS: 0.453592};

/** Total weight of the lines in kg (lines without a weight count as 0). */
export function cartWeightKg(lines: Array<{quantity: number; weight: number | null; weightUnit: WeightUnit}>): number {
  const kg = lines.reduce((sum, line) => sum + line.quantity * (line.weight ?? 0) * TO_KG[line.weightUnit], 0);
  return Math.round(kg * 1000) / 1000;
}

export function applies(when: RuleWhen | undefined, context: DeliveryContext): boolean {
  if (!when) return true;
  if (when.minWeightKg !== undefined && context.weightKg < when.minWeightKg) return false;
  if (when.minSubtotal !== undefined && context.subtotal < when.minSubtotal) return false;
  if (when.countries && (!context.countryCode || !when.countries.includes(context.countryCode))) return false;
  return true;
}

const matchesMethod = (methods: string[], title: string | null) =>
  !!title && methods.some((method) => method.trim().toLowerCase() === title.trim().toLowerCase());

/**
 * Operations for one delivery group. Rules match options by their *original* title, so a
 * rename never stops a later rule from matching. A hidden option is not renamed or moved.
 */
export function deliveryOperations(config: DeliveryRulesConfig, options: OptionLike[], context: DeliveryContext): DeliveryOperation[] {
  const active = config.rules.filter((rule) => applies(rule.when, context));
  const hidden = new Set<string>();
  const operations: DeliveryOperation[] = [];

  for (const rule of active.filter((r) => r.action === 'hide')) {
    for (const option of options) {
      if (matchesMethod(rule.methods, option.title) && !hidden.has(option.handle)) {
        hidden.add(option.handle);
        operations.push({type: 'hide', handle: option.handle});
      }
    }
  }
  for (const rule of active) {
    if (rule.action === 'hide') continue;
    for (const option of options) {
      if (hidden.has(option.handle) || !matchesMethod(rule.methods, option.title)) continue;
      operations.push(
        rule.action === 'rename'
          ? {type: 'rename', handle: option.handle, title: rule.title}
          : {type: 'move', handle: option.handle, index: rule.index},
      );
    }
  }
  return operations;
}

export function parseDeliveryRules(raw: unknown): DeliveryRulesConfig | null {
  const data = typeof raw === 'string' ? safeJson(raw) : raw;
  if (typeof data !== 'object' || data === null) return null;
  const c = data as Record<string, any>;
  if (c.version !== 1 || !Array.isArray(c.rules)) return null;
  const strings = (list: unknown) => Array.isArray(list) && list.length > 0 && list.every((s) => typeof s === 'string');
  const whenOk = (w: any) =>
    w === undefined ||
    (typeof w === 'object' &&
      w !== null &&
      (w.minWeightKg === undefined || typeof w.minWeightKg === 'number') &&
      (w.minSubtotal === undefined || typeof w.minSubtotal === 'number') &&
      (w.countries === undefined || strings(w.countries)));
  const rules = c.rules.filter(
    (r: any): r is DeliveryRule =>
      r &&
      strings(r.methods) &&
      whenOk(r.when) &&
      ((r.action === 'hide') ||
        (r.action === 'rename' && typeof r.title === 'string' && r.title.length > 0) ||
        (r.action === 'move' && Number.isInteger(r.index) && r.index >= 0)),
  );
  return {version: 1, rules};
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
