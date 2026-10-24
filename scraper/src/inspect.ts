/**
 * Feilsøkingsverktøy for å utvide kilder og ordbok.
 *
 *   npm run inspect -- --url https://…/oppskrift     viser JSON-LD, språk og ingrediensklasser på en side
 *   npm run inspect -- --robots https://www.godt.no  viser robots.txt-sitemaps og eksempel-URL-er
 *   npm run inspect -- --mvt kylling,bacon           søker i Matvaretabellen
 *   npm run inspect -- --line "2 dl hakkede tomater" viser hvordan en ingredienslinje tolkes
 *   npm run inspect -- --matinfo kokosmelk           søker på matinfo.no og viser næringsinnholdet som blir lest
 */
import * as cheerio from 'cheerio';
import path from 'node:path';
import { loadDictionary, SCRAPER_DIR } from './dictionary.ts';
import { extractRecipe } from './extract.ts';
import { PoliteFetcher } from './http.ts';
import { IngredientParser } from './ingredientParser.ts';
import { lookupMatinfo, MATINFO_BASE, parseSearchResults } from './matinfo.ts';
import { loadMvt } from './nutrition.ts';

const args = process.argv.slice(2);
const get = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const ua = 'Middagsplanlegger/1.0 (inspect)';
const http = new PoliteFetcher(ua, 1000);

async function inspectUrl(url: string) {
  const res = await http.get(url);
  const $ = cheerio.load(res.body);
  console.log(`\n=== ${url} → HTTP ${res.status}, ${res.body.length} tegn, lang=${$('html').attr('lang')}`);
  $('script[type="application/ld+json"]').each((i, el) => {
    const t = $(el).contents().text().trim();
    let types = '?';
    try {
      const d = JSON.parse(t);
      const collect = (x: unknown): string[] =>
        Array.isArray(x) ? x.flatMap(collect) : x && typeof x === 'object' ? [String((x as Record<string, unknown>)['@type']), ...collect((x as Record<string, unknown>)['@graph'])] : [];
      types = collect(d).join(', ');
    } catch {
      types = 'ugyldig JSON';
    }
    console.log(`  ld+json #${i}: typer [${types}] ${t.slice(0, 300).replace(/\s+/g, ' ')}`);
  });
  const classes = new Map<string, number>();
  $('[class]').each((_, el) => {
    for (const c of ($(el).attr('class') ?? '').split(/\s+/)) if (/ingred|recipe|oppskrift|portion|porsjon/i.test(c)) classes.set(c, (classes.get(c) ?? 0) + 1);
  });
  console.log('  klasser:', [...classes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([c, n]) => `${c}(${n})`).join(' '));
  console.log('  itemprop:', [...new Set($('[itemprop]').toArray().map((e) => $(e).attr('itemprop')))].join(' '));
  const snip = get('snippet');
  if (snip) console.log(`  html for ${snip}:`, ($.html($(snip).first()) ?? '').replace(/\s+/g, ' ').slice(0, 2500));
  const links = [...new Set($('a[href]').toArray().map((a) => $(a).attr('href') ?? ''))].filter((h) => /oppskrift|recipe/i.test(h));
  console.log(`  lenker med oppskrift/recipe (${links.length}):`, links.slice(0, 20).join(' '));
  const r = extractRecipe(res.body);
  console.log('  uttrekk:', r ? JSON.stringify({ ...r, instructions: r.instructions.length }).slice(0, 800) : 'ingen oppskrift funnet');
}

async function inspectRobots(origin: string) {
  const sm = await http.sitemapsFromRobots(origin);
  console.log(`\n=== ${origin} robots-sitemaps: ${sm.join(' ') || '(ingen)'}; tillatt "/": ${await http.isAllowed(origin + '/')}`);
  for (const s of sm.slice(0, 3)) {
    try {
      const res = await http.get(s);
      const locs = [...res.body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]);
      console.log(`  ${s}: HTTP ${res.status}, ${locs.length} loc, f.eks. ${locs.slice(0, 8).join(' ')}`);
    } catch (e) {
      console.log(`  ${s}: ${(e as Error).message}`);
    }
  }
}

async function main() {
  for (const u of (get('url') ?? '').split(',').filter(Boolean)) await inspectUrl(u).catch((e) => console.log(u, e.message));
  for (const o of (get('robots') ?? '').split(',').filter(Boolean)) await inspectRobots(o).catch((e) => console.log(o, e.message));
  const terms = get('mvt');
  if (terms) {
    const foods = await loadMvt(path.join(SCRAPER_DIR, 'cache', 'matvaretabellen.json'), ua, console.log);
    for (const t of terms.split(',')) {
      const hits = foods.filter((f) => f.foodName.toLowerCase().includes(t.toLowerCase()));
      console.log(`\n=== Matvaretabellen "${t}": ${hits.length} treff`);
      for (const h of hits.slice(0, 40)) console.log(`  ${h.foodId}  ${h.foodName}  ${h.per100g.kcal} kcal`);
    }
  }
  for (const q of (get('matinfo') ?? '').split(',').filter(Boolean)) {
    const res = await http.get(`${MATINFO_BASE}/resultat?query=${encodeURIComponent(q)}`);
    const hits = parseSearchResults(res.body);
    console.log(`\n=== matinfo.no "${q}": HTTP ${res.status}, ${hits.length} produkter`);
    for (const h of hits.slice(0, 15)) console.log(`  ${h.name}  ${h.url}`);
    console.log('  valgt:', JSON.stringify(await lookupMatinfo(http, q, console.log)));
  }
  const line = get('line');
  if (line) {
    const parser = new IngredientParser(loadDictionary());
    console.log(JSON.stringify(parser.parse(line), null, 1));
  }
}

main();
