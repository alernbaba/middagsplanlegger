/**
 * Priser fra nettbutikkene til Oda og MENY. Hver ordbokvare søkes opp i begge butikkene, og
 * en typisk kilo-, liter- eller stykkpris regnes om til kroner per kjøpsenhet i ordboken.
 * Resultatene lagres i scraper/prices.json og hentes på nytt når de er eldre enn 6 dager,
 * så prisene følger den ukentlige innhentingen.
 */
import fs from 'node:fs';
import type { PriceStore, StorePrice } from '../../shared/types.ts';
import { gramsPerBuyUnit, type DictIngredient } from './dictionary.ts';
import type { PoliteFetcher } from './http.ts';

export const PRICE_STORES: PriceStore[] = ['oda', 'meny'];
const MAX_AGE_DAYS = 6;

export interface PriceEntry {
  query: string;
  date: string;
  oda?: StorePrice;
  meny?: StorePrice;
}

/** Et produkt slik butikkenes søk beskriver det. */
export interface StoreProduct {
  name: string;
  url?: string;
  /** Pris for én salgsenhet (pakke, boks, stk). */
  price: number;
  /** Sammenligningspris, f.eks. kr per kg. */
  unitPrice: number;
  unit: string;
}

export function loadPriceCache(file: string): Record<string, PriceEntry> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function savePriceCache(file: string, cache: Record<string, PriceEntry>) {
  const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(file, JSON.stringify(sorted, null, 1) + '\n');
}

export function isPriceFresh(e: PriceEntry | undefined, query: string, now = Date.now()): boolean {
  return !!e && e.query === query && now - Date.parse(e.date) < MAX_AGE_DAYS * 86400000;
}

/** Søkeordet for en vare: `pris` i ordboken, ellers navnet uten parenteser. Tom streng = ikke slå opp. */
export function priceQuery(ing: DictIngredient): string {
  return (ing.pris ?? ing.name.replace(/\(.*?\)/g, '').split('/')[0]).trim().toLowerCase();
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN);

function normUnit(u: unknown): string {
  const s = String(u ?? '').toLowerCase().replace(/\.$/, '');
  if (s === 'kg' || s === 'kilo') return 'kg';
  if (s === 'l' || s === 'ltr' || s === 'liter') return 'l';
  if (s === 'stk' || s === 'st' || s === 'each') return 'stk';
  return s;
}

interface OdaItem {
  type?: string;
  attributes?: {
    full_name?: string;
    gross_price?: string;
    gross_unit_price?: string;
    unit_price_quantity_abbreviation?: string;
    front_url?: string;
    availability?: { is_available?: boolean };
  };
}

export function parseOda(json: unknown): StoreProduct[] {
  const items = ((json as { items?: OdaItem[] })?.items ?? []).filter((i) => i.type === 'product' && i.attributes);
  return items
    .filter((i) => i.attributes!.availability?.is_available !== false)
    .map((i) => {
      const a = i.attributes!;
      return { name: a.full_name ?? '', url: a.front_url, price: num(a.gross_price), unitPrice: num(a.gross_unit_price), unit: normUnit(a.unit_price_quantity_abbreviation) };
    })
    .filter((p) => p.name && p.price > 0 && p.unitPrice > 0);
}

interface MenyHit {
  title?: string;
  contentData?: {
    title?: string;
    subtitle?: string;
    slugifiedUrl?: string;
    pricePerUnit?: number;
    comparePricePerUnit?: number;
    compareUnit?: string;
    isForSale?: boolean;
    isOutOfStock?: boolean;
  };
}

export function parseMeny(json: unknown): StoreProduct[] {
  const hits = (json as { hits?: MenyHit[] })?.hits ?? [];
  return hits
    .filter((h) => h.contentData && h.contentData.isForSale !== false && h.contentData.isOutOfStock !== true)
    .map((h) => {
      const c = h.contentData!;
      return {
        name: [c.title ?? h.title, c.subtitle].filter(Boolean).join(' '),
        url: c.slugifiedUrl ? `https://meny.no/varer${c.slugifiedUrl}` : undefined,
        price: num(c.pricePerUnit),
        unitPrice: num(c.comparePricePerUnit),
        unit: normUnit(c.compareUnit),
      };
    })
    .filter((p) => p.name && p.price > 0 && p.unitPrice > 0);
}

const WORD_CHARS = 'a-zæøåäöéèüç0-9';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Ferdigretter, drikker og krydderblandinger som ofte dukker opp i søket uten å være varen selv. */
const AVOID = ['pulver', 'krydder', 'saus', 'miks', 'mix', 'chips', 'snacks', 'juice', 'drikk', 'smoothie', 'dressing', 'marinert', 'marinade', 'suppe', 'salat', 'barnemat', 'pålegg', 'pizza', 'paté', 'postei', 'kake', 'is', 'godteri', 'gryte', 'wrap', 'burger', 'nuggets', 'dyrefor', 'hundemat', 'kattemat'];

/** Produkter der hvert søkeord starter et ord i navnet, uten ferdigretter som ikke var det som ble søkt etter. */
export function rankStoreProducts(products: StoreProduct[], query: string): StoreProduct[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const res = words.map((w) => new RegExp(`(^|[^${WORD_CHARS}])${escape(w)}`, 'i'));
  // Korte ord må stå alene («is» skal ikke treffe «ris»); lengre ord treffer også i starten eller slutten av sammensetninger.
  const avoid = AVOID.filter((a) => !query.includes(a)).map((a) =>
    a.length <= 3
      ? new RegExp(`(^|[^${WORD_CHARS}])${escape(a)}($|[^${WORD_CHARS}])`, 'i')
      : new RegExp(`(^|[^${WORD_CHARS}])${escape(a)}|${escape(a)}($|[^${WORD_CHARS}])`, 'i'),
  );
  return products.filter((p) => res.every((r) => r.test(p.name)) && !avoid.some((r) => r.test(p.name)));
}

/**
 * Kroner per kjøpsenhet (per g, ml eller stk) for et produkt. Varer som kjøpes i boks, potte eller bunt
 * bruker prisen for én salgsenhet; ellers regnes kilo-/literprisen om med vekt og tetthet fra ordboken.
 */
export function pricePerBuyUnit(p: StoreProduct, ing: DictIngredient): number | undefined {
  const density = ing.density ?? 1;
  if (ing.buy === 'g') {
    if (p.unit === 'kg') return p.unitPrice / 1000;
    if (p.unit === 'l') return p.unitPrice / 1000 / density;
    return undefined;
  }
  if (ing.buy === 'ml') {
    if (p.unit === 'l') return p.unitPrice / 1000;
    if (p.unit === 'kg') return (p.unitPrice / 1000) * density;
    return undefined;
  }
  if (p.unit === 'stk') return p.unitPrice;
  const container = ing.label && ing.label[0] !== 'stk' && ['boks', 'potte', 'bunt', 'pakke'].includes(ing.label[0]);
  if (container) return p.price;
  const gpu = gramsPerBuyUnit(ing);
  if (p.unit === 'kg') return (p.unitPrice * gpu) / 1000;
  if (p.unit === 'l') return (p.unitPrice * gpu) / 1000 / density;
  return undefined;
}

/** Velger en typisk pris: medianen av de fem mest relevante treffene som kan regnes om. */
export function pickPrice(products: StoreProduct[], query: string, ing: DictIngredient): StorePrice | undefined {
  const priced = rankStoreProducts(products, query)
    .map((p) => ({ p, per: pricePerBuyUnit(p, ing) }))
    .filter((x): x is { p: StoreProduct; per: number } => x.per !== undefined && Number.isFinite(x.per) && x.per > 0)
    .slice(0, 5)
    .sort((a, b) => a.per - b.per);
  if (!priced.length) return undefined;
  const m = priced[Math.floor((priced.length - 1) / 2)];
  const round = (n: number) => Number(n.toPrecision(4));
  return { perUnit: round(m.per), product: m.p.name, ...(m.p.url ? { url: m.p.url } : {}) };
}

export const ODA_SEARCH = 'https://oda.com/api/v1/search/mixed/?q=';
/** MENY sin produktsøk (NorgesGruppens plattform, kjede 1300). */
export const MENY_SEARCH = 'https://platform-rest-prod.ngdata.no/api/episearch/1300/products?page_size=20&search=';

export async function lookupPrices(http: PoliteFetcher, query: string, ing: DictIngredient, log: (s: string) => void): Promise<PriceEntry> {
  const entry: PriceEntry = { query, date: new Date().toISOString().slice(0, 10) };
  const q = encodeURIComponent(query);
  const sources: [PriceStore, string, (j: unknown) => StoreProduct[]][] = [
    ['oda', ODA_SEARCH + q, parseOda],
    ['meny', MENY_SEARCH + q, parseMeny],
  ];
  await Promise.all(
    sources.map(async ([store, url, parse]) => {
      try {
        const res = await http.getJson(url);
        if (!res.data) {
          log(`priser: ${store} svarte HTTP ${res.status} for «${query}»`);
          return;
        }
        const hit = pickPrice(parse(res.data), query, ing);
        if (hit) entry[store] = hit;
      } catch (e) {
        log(`priser: ${store} feilet for «${query}»: ${(e as Error).message}`);
      }
    }),
  );
  return entry;
}
