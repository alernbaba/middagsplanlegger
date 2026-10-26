/**
 * Innhenting av oppskrifter. Kjøres av GitHub Actions (se .github/workflows/scrape.yml).
 *
 *   npm run scrape                      vanlig kjøring, skriver public/data/recipes.json
 *   npm run scrape -- --limit 3         maks 3 nye oppskrifter per kilde
 *   npm run scrape -- --sources matprat bare valgte kilder (kommaseparert)
 *   npm run scrape -- --out fil.json    skriv til en annen fil
 *   npm run scrape -- --no-deadcheck    hopp over sjekk av gamle lenker
 *   npm run scrape -- --no-priser       ikke hent priser fra Oda og MENY
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Recipe, RecipesFile } from '../../shared/types.ts';
import { discoverUrls, type SourceConfig } from './discover.ts';
import { loadDictionary, ROOT_DIR, SCRAPER_DIR } from './dictionary.ts';
import { looksLikeDinner, looksForeign } from './classify.ts';
import { buildIngredientInfo, enrichRecipe, type EnrichContext } from './enrich.ts';
import * as cheerio from 'cheerio';
import { extractRecipe, type RawRecipe } from './extract.ts';
import { PoliteFetcher, RobotsDisallowed } from './http.ts';
import { IngredientParser } from './ingredientParser.ts';
import { isFresh, loadMatinfoCache, lookupMatinfo, saveMatinfoCache } from './matinfo.ts';
import { loadMvt, matchDictionary } from './nutrition.ts';
import { isPriceFresh, loadPriceCache, lookupPrices, priceQuery, PRICE_STORES, savePriceCache } from './prices.ts';

interface Settings {
  lagreFremgangsmate: boolean;
  maxNewPerSource: number;
  deadLinkChecksPerSource: number;
  requestIntervalMs: number;
  userAgent: string;
  /** Slå opp varer uten treff i Matvaretabellen på matinfo.no. */
  matinfoReserve?: boolean;
  /** Hent priser fra Oda og MENY. */
  priser?: boolean;
}

interface SourceReport {
  name: string;
  discovered: number;
  added: number;
  updated: number;
  removed: number;
  failed: number;
  notRecipe: number;
  notDinner: number;
  wrongLanguage: number;
  locked: number;
  error?: string;
  samples: string[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const log = (s: string) => console.log(s);

function slugId(source: string, url: string, taken: Set<string>): string {
  const u = new URL(url);
  const seg = u.pathname.split('/').filter(Boolean).pop() ?? 'oppskrift';
  const base = `${source}-${seg}`
    .toLowerCase()
    .replace(/[æ]/g, 'ae').replace(/[ø]/g, 'o').replace(/[å]/g, 'a')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90);
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  taken.add(id);
  return id;
}

function toRecipe(raw: RawRecipe, src: SourceConfig, url: string, id: string, settings: Settings, ctx: EnrichContext, prev?: Recipe): Recipe {
  const now = new Date().toISOString();
  return enrichRecipe(
    {
      id,
      source: src.id,
      sourceName: src.name,
      url,
      name: raw.name,
      language: src.language && src.language !== 'nb' ? src.language : undefined,
      image: raw.image ? new URL(raw.image, url).href : undefined,
      totalTime: raw.totalTime,
      servings: raw.servings ?? 4,
      instructions: settings.lagreFremgangsmate && raw.instructions.length ? raw.instructions : undefined,
      siteNutrition: raw.siteNutrition,
      firstSeen: prev?.firstSeen ?? now,
      lastSeen: now,
    },
    raw.ingredients,
    ctx,
  );
}

/** Lager en sammenlignbar nøkkel for å se om en oppskrift faktisk endret seg. */
function fingerprint(r: Recipe) {
  const { lastSeen: _l, firstSeen: _f, ...rest } = r;
  return JSON.stringify(rest);
}

async function main() {
  const t0 = Date.now();
  const config = JSON.parse(fs.readFileSync(path.join(SCRAPER_DIR, 'sources.json'), 'utf8'));
  const settings: Settings = config.settings;
  const repo = process.env.GITHUB_REPOSITORY ?? 'middagsplanlegger';
  settings.userAgent = settings.userAgent.replace('{repo}', repo);
  const limit = arg('limit') ? Number(arg('limit')) : settings.maxNewPerSource;
  const only = arg('sources')?.split(',');
  const outFile = path.resolve(ROOT_DIR, arg('out') ?? 'public/data/recipes.json');
  const existingFile = path.resolve(ROOT_DIR, 'public/data/recipes.json');
  const deadcheck = !process.argv.includes('--no-deadcheck');

  const dict = loadDictionary();
  const parser = new IngredientParser(dict);
  const foods = await loadMvt(path.join(SCRAPER_DIR, 'cache', 'matvaretabellen.json'), settings.userAgent, log);
  const mvt = matchDictionary(dict, foods);
  const http = new PoliteFetcher(settings.userAgent, settings.requestIntervalMs);

  // Reserve: varer uten treff i Matvaretabellen slås opp på matinfo.no (resultatet huskes i scraper/matinfo.json).
  if (settings.matinfoReserve !== false && !process.argv.includes('--no-matinfo')) {
    const file = path.join(SCRAPER_DIR, 'matinfo.json');
    const cache = loadMatinfoCache(file);
    let looked = 0;
    let found = 0;
    for (const m of Object.values(mvt)) {
      if (m.source !== 'ordbok') continue;
      const ing = dict.ingredients[m.id];
      const query = (ing.matinfo ?? ing.name.replace(/\(.*?\)/g, '').split('/')[0]).trim().toLowerCase();
      if (!query) continue;
      if (!isFresh(cache[m.id], query)) {
        try {
          cache[m.id] = await lookupMatinfo(http, query, log);
          looked++;
        } catch (e) {
          log(`matinfo: ${m.id} feilet: ${(e as Error).message}`);
          continue;
        }
      }
      const hit = cache[m.id];
      const fb = m.per100g;
      // Samme rimelighetskontroll som for Matvaretabellen.
      if (hit?.per100g && (fb.kcal === 0 || Math.abs(hit.per100g.kcal - fb.kcal) <= Math.max(0.6 * fb.kcal, 80))) {
        mvt[m.id] = { ...m, query, foodName: hit.product?.replace(/\s*Informasjonseier:.*$/i, ''), per100g: hit.per100g, source: 'matinfo' };
        found++;
      }
    }
    saveMatinfoCache(file, cache);
    log(`matinfo.no: ${found} varer fikk næringsinnhold herfra (${looked} nye oppslag)`);
  }

  // Priser fra Oda og MENY (resultatet huskes i scraper/prices.json i 6 dager).
  const priceFile = path.join(SCRAPER_DIR, 'prices.json');
  const priceCache = loadPriceCache(priceFile);
  if (settings.priser !== false && !process.argv.includes('--no-priser')) {
    let looked = 0;
    for (const [id, ing] of Object.entries(dict.ingredients)) {
      const query = priceQuery(ing);
      if (!query) {
        delete priceCache[id];
        continue;
      }
      if (isPriceFresh(priceCache[id], query)) continue;
      priceCache[id] = await lookupPrices(http, query, ing, log);
      looked++;
    }
    for (const id of Object.keys(priceCache)) if (!dict.ingredients[id]) delete priceCache[id];
    savePriceCache(priceFile, priceCache);
    const count = (s: (typeof PRICE_STORES)[number]) => Object.values(priceCache).filter((e) => e[s]).length;
    log(`Priser: ${count('oda')} varer fra Oda og ${count('meny')} fra MENY av ${Object.keys(dict.ingredients).length} (${looked} nye oppslag)`);
  }
  const prices = Object.fromEntries(
    Object.entries(priceCache)
      .filter(([id]) => dict.ingredients[id] && priceQuery(dict.ingredients[id]))
      .map(([id, e]) => [id, Object.fromEntries(PRICE_STORES.filter((s) => e[s]).map((s) => [s, e[s]!]))]),
  );
  const pricesDate = Object.values(priceCache).map((e) => e.date).sort().pop();

  const cuisineBySource = Object.fromEntries((config.sources as SourceConfig[]).filter((s) => s.cuisine).map((s) => [s.id, s.cuisine!]));
  const ctx: EnrichContext = { dict, parser, mvt, unmatched: new Map(), cuisineBySource, prices };
  if (foods.length) {
    const report = Object.values(mvt).map((m) => ({ id: m.id, søk: m.query, matvare: m.foodName ?? null, kilde: m.source, per100g: m.per100g }));
    fs.writeFileSync(path.join(SCRAPER_DIR, 'mvt-matches.json'), JSON.stringify(report, null, 1) + '\n');
    const miss = report.filter((r) => r.kilde === 'ordbok' && r.søk);
    log(`Matvaretabellen: ${report.length - miss.length} av ${report.length} ordbokvarer matchet` + (miss.length ? ` (uten treff: ${miss.map((m) => m.id).join(', ')})` : ''));
  }

  const existing: RecipesFile | undefined = fs.existsSync(existingFile) ? JSON.parse(fs.readFileSync(existingFile, 'utf8')) : undefined;
  const byId = new Map<string, Recipe>();
  const byUrl = new Map<string, Recipe>();
  const taken = new Set<string>();
  const sources: SourceConfig[] = config.sources;
  const srcById = new Map(sources.map((s) => [s.id, s]));
  const reports = new Map<string, SourceReport>();
  const rep = (id: string) => {
    if (!reports.has(id)) reports.set(id, { name: srcById.get(id)?.name ?? id, discovered: 0, added: 0, updated: 0, removed: 0, failed: 0, notRecipe: 0, notDinner: 0, wrongLanguage: 0, locked: 0, samples: [] });
    return reports.get(id)!;
  };

  // Tolk eksisterende oppskrifter på nytt med gjeldende ordbok og næringsdata.
  for (const old of existing?.recipes ?? []) {
    // Filtrene kan ha blitt strengere siden oppskriften ble hentet.
    if ((!old.language && looksForeign(old.name)) || !looksLikeDinner(old.name, [], old.url)) {
      rep(old.source).removed++;
      continue;
    }
    const re = enrichRecipe({ ...old }, old.ingredients.map((i) => i.raw).filter((x, i, a) => a.indexOf(x) === i), ctx);
    if (!settings.lagreFremgangsmate) delete re.instructions;
    if (fingerprint(re) !== fingerprint(old)) rep(old.source).updated++;
    byId.set(re.id, re);
    byUrl.set(re.url, re);
    taken.add(re.id);
  }

  // Sider som er hoppet over tidligere (låst, ikke middag, annet språk) hentes ikke på nytt før etter 90 dager.
  const skippedFile = path.join(SCRAPER_DIR, 'skipped.json');
  const skipped: Record<string, { reason: string; date: string }> = fs.existsSync(skippedFile) ? JSON.parse(fs.readFileSync(skippedFile, 'utf8')) : {};
  const cutoff = new Date(t0 - 90 * 86400000).toISOString();
  for (const [u, v] of Object.entries(skipped)) if (v.date < cutoff) delete skipped[u];
  const skip = (url: string, reason: string) => (skipped[url] = { reason, date: new Date().toISOString().slice(0, 10) });

  // Kildene kjøres parallelt; høfligheten håndheves per vert i PoliteFetcher.
  await Promise.all(
    sources
      .filter((s) => s.enabled !== false && (!only || only.includes(s.id)))
      .map(async (src) => {
        const r = rep(src.id);
        try {
          log(`[${src.id}] finner oppskrifter …`);
          const urls = await discoverUrls(src, http, (s) => log(`[${src.id}] ${s}`));
          r.discovered = urls.length;
          r.samples = urls.slice(0, 3);
          log(`[${src.id}] ${urls.length} kandidat-URL-er`);
          if (urls.length === 0) r.error = 'fant ingen oppskrifts-URL-er (sjekk sitemaps/urlPattern)';
          const fresh = urls.filter((u) => !byUrl.has(u) && !skipped[u]);
          let attempts = 0;
          for (const url of fresh) {
            if (r.added >= limit || attempts >= limit * 5) break;
            attempts++;
            try {
              const res = await http.get(url);
              if (res.status >= 400) {
                r.failed++;
                log(`[${src.id}] HTTP ${res.status} ${url}`);
                continue;
              }
              if (src.skipIfSelector && cheerio.load(res.body)(src.skipIfSelector).length) {
                r.locked++;
                skip(url, 'låst');
                continue;
              }
              const raw = extractRecipe(res.body, src.html);
              if (!raw) {
                r.notRecipe++;
                skip(url, 'ikke oppskrift');
                continue;
              }
              // Norske kilder: bare norsk. Kilder med eget språk (f.eks. engelske filippinske sider): bare det språket.
              const wrongLanguage = src.language && src.language !== 'nb'
                ? !!raw.language && !raw.language.toLowerCase().startsWith(src.language)
                : (!!raw.language && !/^(nb|no|nn)\b/i.test(raw.language)) || looksForeign(raw.name);
              if (wrongLanguage) {
                r.wrongLanguage++;
                skip(url, 'annet språk');
                continue;
              }
              if (!looksLikeDinner(raw.name, raw.tags, url)) {
                r.notDinner++;
                skip(url, 'ikke middag');
                log(`[${src.id}] hopper over (ikke middag): ${raw.name}`);
                continue;
              }
              const recipe = toRecipe(raw, src, url, slugId(src.id, url, taken), settings, ctx);
              byId.set(recipe.id, recipe);
              byUrl.set(url, recipe);
              r.added++;
              log(`[${src.id}] + ${recipe.name} (${raw.via}, ${recipe.ingredients.length} ingredienser, ${Math.round(recipe.matchedShare * 100)} % tolket, ${recipe.perServing.kcal} kcal/porsjon)`);
            } catch (e) {
              if (e instanceof RobotsDisallowed) {
                r.error = 'robots.txt tillater ikke innhenting';
                log(`[${src.id}] ${e.message} – hopper over kilden`);
                break;
              }
              r.failed++;
              log(`[${src.id}] feil for ${url}: ${(e as Error).message}`);
            }
          }

          // Sjekk de eldste lenkene: fjern døde, oppdater levende.
          if (deadcheck) {
            const old = [...byId.values()]
              .filter((x) => x.source === src.id && x.lastSeen < new Date(t0).toISOString())
              .sort((a, b) => a.lastSeen.localeCompare(b.lastSeen))
              .slice(0, settings.deadLinkChecksPerSource);
            for (const rec of old) {
              try {
                const res = await http.get(rec.url);
                if (res.status === 404 || res.status === 410) {
                  byId.delete(rec.id);
                  byUrl.delete(rec.url);
                  r.removed++;
                  log(`[${src.id}] - ${rec.name} (HTTP ${res.status})`);
                } else if (res.status < 400) {
                  const raw = extractRecipe(res.body, src.html);
                  if (raw) {
                    const upd = toRecipe(raw, src, rec.url, rec.id, settings, ctx, rec);
                    if (fingerprint(upd) !== fingerprint(rec)) r.updated++;
                    byId.set(rec.id, upd);
                  } else {
                    byId.set(rec.id, { ...rec, lastSeen: new Date().toISOString() });
                  }
                }
              } catch (e) {
                if (e instanceof RobotsDisallowed) break;
                log(`[${src.id}] lenkesjekk feilet for ${rec.url}: ${(e as Error).message}`);
              }
            }
          }
        } catch (e) {
          r.error = (e as Error).message;
          log(`[${src.id}] KILDEN FEILET: ${(e as Error).message}`);
        }
      }),
  );

  const recipes = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const file: RecipesFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    lagreFremgangsmate: settings.lagreFremgangsmate,
    ...(pricesDate ? { pricesDate } : {}),
    ingredients: buildIngredientInfo(recipes, ctx),
    recipes,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(file) + '\n');

  fs.writeFileSync(skippedFile, JSON.stringify(Object.fromEntries(Object.entries(skipped).sort()), null, 1) + '\n');

  // Linjer som ikke kunne tolkes, slik at ordboken kan utvides.
  const unmatched = [...ctx.unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 1000).map(([tekst, antall]) => ({ tekst, antall }));
  fs.writeFileSync(path.join(SCRAPER_DIR, 'unmatched.json'), JSON.stringify(unmatched, null, 1) + '\n');

  // Rapport
  const rows = [...reports.values()].map((r) => `| ${r.name} | ${r.discovered} | ${r.added} | ${r.updated} | ${r.removed} | ${r.failed} | ${r.notRecipe} / ${r.notDinner} / ${r.wrongLanguage} / ${r.locked} | ${r.error ?? ''} |`);
  const uncertain = recipes.filter((x) => x.uncertain).length;
  const summary = [
    '## Innhenting av oppskrifter',
    '',
    '| Kilde | Funnet | Nye | Oppdaterte | Fjernede | Feilede | Hoppet over (ikke oppskrift / ikke middag / annet språk / låst) | Merknad |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...rows,
    '',
    `Totalt ${recipes.length} oppskrifter (${uncertain} med usikker næringsberegning). ${http.requests} forespørsler på ${Math.round((Date.now() - t0) / 1000)} s.`,
    `Linjer som ikke kunne tolkes: ${ctx.unmatched.size} ulike (se scraper/unmatched.json). Mest vanlige: ${unmatched.slice(0, 15).map((u) => `"${u.tekst}" (${u.antall})`).join(', ')}`,
    '',
    ...[...reports.entries()].filter(([, r]) => r.samples.length).map(([, r]) => `- ${r.name}: eksempel-URL-er ${r.samples.join(' , ')}`),
  ].join('\n');
  log('\n' + summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
