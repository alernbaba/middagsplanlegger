/**
 * Reserve for næringsinnhold: produktdatabasen på matinfo.no (produkter.matinfo.no).
 * Brukes bare for ordbokvarer som ikke har treff i Matvaretabellen. Resultatene lagres i
 * scraper/matinfo.json, så hver vare slås opp på nytt først etter 90 dager.
 */
import * as cheerio from 'cheerio';
import fs from 'node:fs';
import type { Nutrition } from '../../shared/types.ts';
import type { PoliteFetcher } from './http.ts';

export const MATINFO_BASE = 'https://produkter.matinfo.no';
const MAX_AGE_DAYS = 90;

export interface MatinfoEntry {
  query: string;
  date: string;
  product?: string;
  url?: string;
  per100g?: Nutrition;
}

export function loadMatinfoCache(file: string): Record<string, MatinfoEntry> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function saveMatinfoCache(file: string, cache: Record<string, MatinfoEntry>) {
  const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(file, JSON.stringify(sorted, null, 1) + '\n');
}

export function isFresh(e: MatinfoEntry | undefined, query: string, now = Date.now()): boolean {
  return !!e && e.query === query && now - Date.parse(e.date) < MAX_AGE_DAYS * 86400000;
}

/** Produktlenker fra søkeresultatsiden: /Produsent/Produktnavn/GTIN. */
export function parseSearchResults(html: string): { url: string; name: string }[] {
  const $ = cheerio.load(html);
  const out: { url: string; name: string }[] = [];
  const seen = new Set<string>();
  $('a[href]').each((_, a) => {
    const href = new URL($(a).attr('href') ?? '', MATINFO_BASE).href;
    const m = href.match(/^https:\/\/produkter\.matinfo\.no\/[^/]+\/([^/]+)\/(\d{8,14})$/);
    if (!m || seen.has(href)) return;
    seen.add(href);
    const text = $(a).text().replace(/\s+/g, ' ').trim();
    out.push({ url: href, name: text || decodeURIComponent(m[1]).replace(/-/g, ' ') });
  });
  return out;
}

const num = (s: string | undefined) => (s ? Number(s.replace(/\s/g, '').replace(',', '.')) : NaN);

/** Leser næringsdeklarasjonen (per 100 g/ml) fra en produktside. */
export function parseNutrition(html: string): Nutrition | undefined {
  const $ = cheerio.load(html);
  const rows = $('tr')
    .toArray()
    .map((tr) => $(tr).children('td,th').toArray().map((c) => $(c).text()).join(' ').replace(/\s+/g, ' ').trim())
    .filter((t) => /\d/.test(t));
  const row = (re: RegExp) => rows.find((t) => re.test(t) && !/hvorav|herav|mettede|sukkerarter/i.test(t));
  const first = (t: string | undefined) => num(t?.match(/(\d+(?:[.,]\d+)?)/)?.[1]);

  const all = rows.join(' | ');
  let kcal = num(all.match(/(\d+(?:[.,]\d+)?)\s*kcal/i)?.[1]);
  if (!Number.isFinite(kcal)) {
    const kj = num(all.match(/(\d+(?:[.,]\d+)?)\s*kj/i)?.[1]);
    if (Number.isFinite(kj)) kcal = kj / 4.184;
  }
  const fat = first(row(/^fett\b/i));
  const carbs = first(row(/^karbohydrat/i));
  const protein = first(row(/^protein\b/i));
  if (![kcal, fat, carbs, protein].every(Number.isFinite)) return undefined;
  // Grov kontroll av at tallene henger sammen (Atwater ± 25 %).
  const calc = protein * 4 + carbs * 4 + fat * 9;
  if (kcal > 0 && Math.abs(calc - kcal) > Math.max(0.25 * kcal, 30)) return undefined;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return { kcal: Math.round(kcal), protein: r1(protein), fat: r1(fat), carbs: r1(carbs) };
}

/** Velger produkter der navnet inneholder søkeordene, og unngår drikker o.l. når det ikke er det som søkes etter. */
export function rankProducts(results: { url: string; name: string }[], query: string): { url: string; name: string }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const avoid = /smoothie|drikk|juice|shot|is\b|dessert|snacks?/i;
  return results
    .filter((r) => words.every((w) => r.name.toLowerCase().includes(w)))
    .filter((r) => avoid.test(query) || !avoid.test(r.name))
    .sort((a, b) => a.name.length - b.name.length);
}

export async function lookupMatinfo(http: PoliteFetcher, query: string, log: (s: string) => void): Promise<MatinfoEntry> {
  const date = new Date().toISOString().slice(0, 10);
  const res = await http.get(`${MATINFO_BASE}/resultat?query=${encodeURIComponent(query)}`);
  if (res.status >= 400) {
    log(`matinfo: søk etter «${query}» ga HTTP ${res.status}`);
    return { query, date };
  }
  const candidates = rankProducts(parseSearchResults(res.body), query).slice(0, 3);
  for (const c of candidates) {
    const page = await http.get(c.url);
    if (page.status >= 400) continue;
    const per100g = parseNutrition(page.body);
    if (per100g) return { query, date, product: c.name, url: c.url, per100g };
  }
  return { query, date };
}
