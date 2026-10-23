import * as cheerio from 'cheerio';
import type { PoliteFetcher } from './http.ts';

export interface SourceConfig {
  id: string;
  name: string;
  enabled?: boolean;
  baseUrl: string;
  /** Sitemap-URL-er. Tom eller utelatt: hentes fra robots.txt. */
  sitemaps?: string[];
  /** Under-sitemaps i en sitemap-indeks må matche dette mønsteret for å bli fulgt. */
  sitemapFilter?: string;
  /** Start-URL-er (listesider) som brukes i tillegg til, eller i stedet for, sitemap. */
  startUrls?: string[];
  /** Regulært uttrykk som oppskrifts-URL-er må matche. */
  urlPattern: string;
  /** URL-er som matcher dette hoppes over (f.eks. kategorisider). */
  excludePattern?: string;
  maxSitemaps?: number;
  html?: import('./extract.ts').HtmlSelectors;
  /** Hopp over sider der denne CSS-selektoren finnes (f.eks. innhold som krever innlogging). */
  skipIfSelector?: string;
}

function locs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1].replace(/&amp;/g, '&'));
  return out;
}

/** Finner kandidat-URL-er for en kilde. */
export async function discoverUrls(src: SourceConfig, http: PoliteFetcher, log: (s: string) => void): Promise<string[]> {
  const pattern = new RegExp(src.urlPattern, 'i');
  const exclude = src.excludePattern ? new RegExp(src.excludePattern, 'i') : undefined;
  const found = new Set<string>();
  const accept = (u: string) => {
    const clean = u.split('#')[0];
    if (pattern.test(clean) && !exclude?.test(clean)) found.add(clean);
  };

  let sitemaps = src.sitemaps ?? [];
  if (sitemaps.length === 0 && !(src.startUrls?.length)) {
    sitemaps = await http.sitemapsFromRobots(new URL(src.baseUrl).origin);
    if (sitemaps.length === 0) sitemaps = [new URL('/sitemap.xml', src.baseUrl).href];
  }

  const filter = src.sitemapFilter ? new RegExp(src.sitemapFilter, 'i') : undefined;
  const queue = [...sitemaps];
  const seen = new Set<string>();
  const max = src.maxSitemaps ?? 40;
  while (queue.length && seen.size < max) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    try {
      const res = await http.get(sm);
      if (res.status >= 400) {
        log(`  sitemap ${sm}: HTTP ${res.status}`);
        continue;
      }
      const isIndex = /<sitemapindex/i.test(res.body);
      const urls = locs(res.body);
      if (isIndex) {
        // Følg under-sitemaps som ser ut til å inneholde oppskrifter først.
        const subs = urls.filter((u) => !filter || filter.test(u));
        subs.sort((a, b) => Number(/oppskrift|recipe/i.test(b)) - Number(/oppskrift|recipe/i.test(a)));
        queue.push(...subs);
      } else {
        urls.forEach(accept);
      }
    } catch (e) {
      log(`  sitemap ${sm}: ${(e as Error).message}`);
    }
  }

  for (const start of src.startUrls ?? []) {
    try {
      const res = await http.get(start);
      const $ = cheerio.load(res.body);
      $('a[href]').each((_, a) => {
        try {
          accept(new URL($(a).attr('href')!, start).href);
        } catch {
          /* ugyldig lenke */
        }
      });
    } catch (e) {
      log(`  start-URL ${start}: ${(e as Error).message}`);
    }
  }
  return [...found];
}
