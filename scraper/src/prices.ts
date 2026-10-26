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
  /** false når varen er utsolgt; prisen brukes da bare hvis ingen andre treff finnes. */
  available?: boolean;
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
    .map((i) => {
      const a = i.attributes!;
      return {
        name: a.full_name ?? '',
        url: a.front_url,
        price: num(a.gross_price),
        unitPrice: num(a.gross_unit_price),
        unit: normUnit(a.unit_price_quantity_abbreviation),
        ...(a.availability?.is_available === false ? { available: false } : {}),
      };
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
    .filter((h) => h.contentData && h.contentData.isForSale !== false)
    .map((h) => {
      const c = h.contentData!;
      return {
        name: [c.title ?? h.title, c.subtitle].filter(Boolean).join(' '),
        url: c.slugifiedUrl ? `https://meny.no/varer${c.slugifiedUrl}` : undefined,
        price: num(c.pricePerUnit),
        unitPrice: num(c.comparePricePerUnit),
        unit: normUnit(c.compareUnit),
        ...(c.isOutOfStock ? { available: false } : {}),
      };
    })
    .filter((p) => p.name && p.price > 0 && p.unitPrice > 0);
}

/** Ferdigretter, bearbeidede varer og krydderblandinger som ofte dukker opp i søket uten å være varen selv. */
const AVOID = [
  'pulver', 'krydder', 'saus', 'miks', 'mix', 'chips', 'snacks', 'juice', 'drikk', 'smoothie', 'dressing', 'marinert', 'marinade',
  'suppe', 'salat', 'barnemat', 'pålegg', 'pizza', 'paté', 'postei', 'kake', 'kaker', 'is', 'godteri', 'gryte', 'wrap', 'burger',
  'nuggets', 'brød', 'grøt', 'lunsj', 'salami', 'gele', 'potetgull', 'sushi', 'muffin', 'dumpling', 'stroganoff', 'kjøttboller',
  'crostini', 'stekt', 'kokte', 'langpanne', 'skivede', 'raspet', 'syltet', 'soltørket', 'tørket', 'tørkede', 'ajvar', 'aioli',
  'yoghurt', 'ost', 'skyr', 'sauce', 'noodles', 'børek', 'sorbet', 'skumpinner', 'puffet', 'sprøbakt', 'panert', 'røkt', 'gravet',
  'olje', 'urter', 'fenalår', 'pretzels', 'kjeks', 'tagliatelle', 'krydret', 'carne', 'fisketerninger',
  'dyrefor', 'hundemat', 'kattemat',
];
/** Bøyningsendelser som godtas etter søkeordet («tomat» → «tomater», «agurk» → «agurken»). */
const SUFFIXES = ['', 'e', 'r', 'er', 'en', 'ene', 'et', 'a', 'n'];

const words = (s: string) => s.toLowerCase().split(/[^a-zæøåäöéèüçô0-9]+/).filter(Boolean);

/** Ordet i produktnavnet er søkeordet, i bøyd form eller med én bokstav mindre («aubergin»). */
function sameWord(word: string, q: string): boolean {
  if (word.startsWith(q) && SUFFIXES.includes(word.slice(q.length))) return true;
  return word.length >= 5 && q.startsWith(word) && q.length - word.length <= 1;
}

export interface RankedProduct {
  product: StoreProduct;
  /** Lavere er bedre: 0 = søkeordet tidlig i navnet, høyere for sammensatte retter, ord langt ut i navnet og utsolgte varer. */
  tier: number;
}

/** Produkter der hvert søkeord finnes som eget ord i navnet, uten ferdigretter som ikke var det som ble søkt etter. */
export function rankStoreProducts(products: StoreProduct[], query: string): RankedProduct[] {
  const qs = words(query);
  const avoid = AVOID.filter((a) => !qs.some((q) => q.includes(a)));
  const out: RankedProduct[] = [];
  for (const p of products) {
    const ws = words(p.name);
    // Det unngåtte ordet alene eller som del av en sammensetning («potetgull», «hvitløksbrød»). Korte ord bare alene.
    if (ws.some((w) => avoid.some((a) => (a.length <= 3 ? w === a : w.includes(a))))) continue;
    const pos = qs.map((q) => ws.findIndex((w) => sameWord(w, q)));
    if (pos.some((i) => i < 0)) continue;
    let tier = Math.max(...pos) <= 2 ? 0 : 2;
    // Sammensatte produkter: «… med persille», «Salt & pepper», «Bacon og brokkolipai».
    if (!qs.some((q) => ['med', 'og'].includes(q)) && /(^|\s)(med|m\/|og)\s|&/i.test(p.name)) tier += 1;
    if (p.available === false) tier += 4;
    out.push({ product: p, tier });
  }
  return out.sort((a, b) => a.tier - b.tier);
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

/** Velger en typisk pris: medianen av de (inntil fem) mest relevante treffene i beste gruppe som kan regnes om. */
export function pickPrice(products: StoreProduct[], query: string, ing: DictIngredient): StorePrice | undefined {
  const convertible = rankStoreProducts(products, query)
    .map((r) => ({ p: r.product, tier: r.tier, per: pricePerBuyUnit(r.product, ing) }))
    .filter((x): x is { p: StoreProduct; tier: number; per: number } => x.per !== undefined && Number.isFinite(x.per) && x.per > 0);
  const best = Math.min(...convertible.map((x) => x.tier));
  const priced = convertible
    .filter((x) => x.tier === best)
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
