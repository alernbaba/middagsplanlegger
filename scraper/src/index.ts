/**
 * Innhenting av oppskrifter. Kjøres av GitHub Actions (se .github/workflows/scrape.yml).
 *
 *   npm run scrape                      vanlig kjøring, skriver public/data/recipes.json
 *   npm run scrape -- --limit 3         maks 3 nye oppskrifter per kilde
 *   npm run scrape -- --sources matprat bare valgte kilder (kommaseparert)
 *   npm run scrape -- --out fil.json    skriv til en annen fil
 *   npm run scrape -- --no-deadcheck    hopp over sjekk av gamle lenker
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Recipe, RecipesFile } from '../../shared/types.ts';
import { discoverUrls, type SourceConfig } from './discover.ts';
import { loadDictionary, ROOT_DIR, SCRAPER_DIR } from './dictionary.ts';
import { buildIngredientInfo, enrichRecipe, type EnrichContext } from './enrich.ts';
import { extractRecipe, type RawRecipe } from './extract.ts';
import { PoliteFetcher, RobotsDisallowed } from './http.ts';
import { IngredientParser } from './ingredientParser.ts';
import { loadMvt, matchDictionary } from './nutrition.ts';

interface Settings {
  lagreFremgangsmate: boolean;
  maxNewPerSource: number;
  deadLinkChecksPerSource: number;
  requestIntervalMs: number;
  userAgent: string;
}

interface SourceReport {
  name: string;
  discovered: number;
  added: number;
  updated: number;
  removed: number;
  failed: number;
  notRecipe: number;
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
  const ctx: EnrichContext = { dict, parser, mvt, unmatched: new Map() };
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
    if (!reports.has(id)) reports.set(id, { name: srcById.get(id)?.name ?? id, discovered: 0, added: 0, updated: 0, removed: 0, failed: 0, notRecipe: 0, samples: [] });
    return reports.get(id)!;
  };

  // Tolk eksisterende oppskrifter på nytt med gjeldende ordbok og næringsdata.
  for (const old of existing?.recipes ?? []) {
    const re = enrichRecipe({ ...old }, old.ingredients.map((i) => i.raw).filter((x, i, a) => a.indexOf(x) === i), ctx);
    if (!settings.lagreFremgangsmate) delete re.instructions;
    if (fingerprint(re) !== fingerprint(old)) rep(old.source).updated++;
    byId.set(re.id, re);
    byUrl.set(re.url, re);
    taken.add(re.id);
  }

  const http = new PoliteFetcher(settings.userAgent, settings.requestIntervalMs);

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
          const fresh = urls.filter((u) => !byUrl.has(u));
          let attempts = 0;
          for (const url of fresh) {
            if (r.added >= limit || attempts >= limit * 3) break;
            attempts++;
            try {
              const res = await http.get(url);
              if (res.status >= 400) {
                r.failed++;
                log(`[${src.id}] HTTP ${res.status} ${url}`);
                continue;
              }
              const raw = extractRecipe(res.body, src.html);
              if (!raw) {
                r.notRecipe++;
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
    ingredients: buildIngredientInfo(recipes, ctx),
    recipes,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(file) + '\n');

  // Linjer som ikke kunne tolkes, slik at ordboken kan utvides.
  const unmatched = [...ctx.unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 1000).map(([tekst, antall]) => ({ tekst, antall }));
  fs.writeFileSync(path.join(SCRAPER_DIR, 'unmatched.json'), JSON.stringify(unmatched, null, 1) + '\n');

  // Rapport
  const rows = [...reports.values()].map((r) => `| ${r.name} | ${r.discovered} | ${r.added} | ${r.updated} | ${r.removed} | ${r.failed} | ${r.notRecipe} | ${r.error ?? ''} |`);
  const uncertain = recipes.filter((x) => x.uncertain).length;
  const summary = [
    '## Innhenting av oppskrifter',
    '',
    '| Kilde | Funnet | Nye | Oppdaterte | Fjernede | Feilede | Ikke oppskrift | Merknad |',
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
