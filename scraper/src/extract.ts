import * as cheerio from 'cheerio';
import type { Nutrition } from '../../shared/types.ts';

/** Råoppskrift slik den leses fra en side, før normalisering. */
export interface RawRecipe {
  name: string;
  image?: string;
  totalTime?: number;
  servings?: number;
  ingredients: string[];
  instructions: string[];
  siteNutrition?: Partial<Nutrition>;
  /** Språkkode fra JSON-LD (inLanguage) eller <html lang>. */
  language?: string;
  /** Kategorier og stikkord fra siden (recipeCategory, keywords). */
  tags: string[];
  via: 'json-ld' | 'microdata' | 'html';
}

export interface HtmlSelectors {
  name?: string;
  ingredients?: string;
  instructions?: string;
  servings?: string;
  image?: string;
}

/** ISO 8601-varighet (PT1H30M) eller fritekst ("45 min") til minutter. */
export function parseDuration(v: unknown): number | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const iso = v.match(/^P(?:(\d+)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+)S)?$/i);
  if (iso && (iso[1] || iso[2] || iso[3] || iso[4])) {
    const min = Number(iso[1] ?? 0) * 1440 + Number(iso[2] ?? 0) * 60 + Number(iso[3] ?? 0) + Number(iso[4] ?? 0) / 60;
    return min > 0 ? Math.round(min) : undefined;
  }
  const h = v.match(/(\d+(?:[.,]\d+)?)\s*(?:t|timer|time|h)\b/i);
  const m = v.match(/(\d+)\s*(?:min|minutter|m)\b/i);
  if (h || m) return Math.round(Number((h?.[1] ?? '0').replace(',', '.')) * 60 + Number(m?.[1] ?? 0)) || undefined;
  return undefined;
}

export function parseServings(v: unknown): number | undefined {
  if (Array.isArray(v)) {
    for (const x of v) {
      const n = parseServings(x);
      if (n) return n;
    }
    return undefined;
  }
  if (typeof v === 'number') return v > 0 && v < 100 ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const m = v.match(/(\d+)(?:\s*-\s*(\d+))?/);
  if (!m) return undefined;
  const n = m[2] ? Math.round((Number(m[1]) + Number(m[2])) / 2) : Number(m[1]);
  return n > 0 && n < 100 ? n : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return undefined;
  const m = v.replace(',', '.').match(/(\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  let n = Number(m[1]);
  if (/kj\b/i.test(v) && !/kcal/i.test(v)) n = n / 4.184;
  return n;
}

function text(v: unknown): string {
  if (typeof v === 'string') return cheerio.load(`<div>${v}</div>`)('div').text().replace(/\s+/g, ' ').trim();
  return '';
}

function imageUrl(v: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return imageUrl(v[0]);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return imageUrl(o.url ?? o.contentUrl ?? o['@id']);
  }
  return undefined;
}

function instructionsList(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === 'string') return text(v).split(/(?<=\.)\s+(?=\p{Lu})/u).filter(Boolean);
  if (Array.isArray(v)) return v.flatMap(instructionsList);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.itemListElement) return instructionsList(o.itemListElement);
    return [text(o.text ?? o.name)].filter(Boolean);
  }
  return [];
}

function isRecipeType(t: unknown): boolean {
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
}

function findRecipeNodes(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const n of node) findRecipeNodes(n, out);
  } else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (isRecipeType(o['@type'])) out.push(o);
    if (o['@graph']) findRecipeNodes(o['@graph'], out);
    if (o.mainEntity) findRecipeNodes(o.mainEntity, out);
  }
  return out;
}

function fromJsonLd(o: Record<string, unknown>): RawRecipe | undefined {
  const ingredients = (Array.isArray(o.recipeIngredient) ? o.recipeIngredient : Array.isArray(o.ingredients) ? o.ingredients : [])
    .map(text)
    .filter(Boolean);
  const name = text(o.name);
  if (!name || ingredients.length === 0) return undefined;
  const nut = (o.nutrition ?? {}) as Record<string, unknown>;
  const siteNutrition: Partial<Nutrition> = {
    kcal: num(nut.calories),
    protein: num(nut.proteinContent),
    fat: num(nut.fatContent),
    carbs: num(nut.carbohydrateContent),
  };
  const hasNut = Object.values(siteNutrition).some((x) => x !== undefined);
  const total = parseDuration(o.totalTime) ?? sumTimes(parseDuration(o.prepTime), parseDuration(o.cookTime));
  return {
    name,
    image: imageUrl(o.image),
    totalTime: total,
    servings: parseServings(o.recipeYield),
    ingredients,
    instructions: instructionsList(o.recipeInstructions),
    siteNutrition: hasNut ? siteNutrition : undefined,
    language: typeof o.inLanguage === 'string' ? o.inLanguage : undefined,
    tags: [o.recipeCategory, o.keywords, o.recipeCourse]
      .flatMap((x) => (Array.isArray(x) ? x : typeof x === 'string' ? x.split(',') : []))
      .map((x) => text(String(x)).toLowerCase())
      .filter(Boolean),
    via: 'json-ld',
  };
}

function sumTimes(a?: number, b?: number) {
  return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
}

/** Leser oppskrift fra HTML: JSON-LD først, deretter microdata og selektorer fra sources.json. */
export function extractRecipe(html: string, selectors?: HtmlSelectors): RawRecipe | undefined {
  const $ = cheerio.load(html);
  const lang = $('html').attr('lang') || undefined;
  const r = extractInner($, selectors);
  if (r && !r.language) r.language = lang;
  return r;
}

function extractInner($: cheerio.CheerioAPI, selectors?: HtmlSelectors): RawRecipe | undefined {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    const raw = $(el).contents().text().trim();
    if (!raw) continue;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      // Noen sider har kontrolltegn eller flere objekter etter hverandre.
      try {
        data = JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' '));
      } catch {
        continue;
      }
    }
    for (const node of findRecipeNodes(data)) {
      const r = fromJsonLd(node);
      if (r) return r;
    }
  }

  // Microdata (itemprop) som reserve.
  const scope = $('[itemtype*="schema.org/Recipe"]').first();
  if (scope.length) {
    const ingredients = scope.find('[itemprop="recipeIngredient"],[itemprop="ingredients"]').toArray().map((e) => $(e).text().replace(/\s+/g, ' ').trim()).filter(Boolean);
    const name = scope.find('[itemprop="name"]').first().text().trim() || $('h1').first().text().trim();
    if (name && ingredients.length) {
      const img = scope.find('[itemprop="image"]').first();
      return {
        name,
        image: img.attr('src') ?? img.attr('content') ?? $('meta[property="og:image"]').attr('content'),
        totalTime: parseDuration(scope.find('[itemprop="totalTime"]').attr('content') ?? scope.find('[itemprop="totalTime"]').text()),
        servings: parseServings(scope.find('[itemprop="recipeYield"]').attr('content') ?? scope.find('[itemprop="recipeYield"]').text()),
        ingredients,
        instructions: scope.find('[itemprop="recipeInstructions"]').toArray().map((e) => $(e).text().replace(/\s+/g, ' ').trim()).filter(Boolean),
        tags: scope.find('[itemprop="recipeCategory"]').toArray().map((e) => $(e).text().trim().toLowerCase()),
        via: 'microdata',
      };
    }
  }

  // Egne selektorer per kilde.
  if (selectors?.ingredients) {
    const ingredients = $(selectors.ingredients).toArray().map((e) => $(e).text().replace(/\s+/g, ' ').trim()).filter(Boolean);
    const name = $(selectors.name ?? 'h1').first().text().replace(/\s+/g, ' ').trim();
    if (name && ingredients.length) {
      return {
        name,
        image: (selectors.image ? $(selectors.image).first().attr('src') : undefined) ?? $('meta[property="og:image"]').attr('content'),
        servings: selectors.servings ? parseServings($(selectors.servings).first().text()) : undefined,
        ingredients,
        instructions: selectors.instructions ? $(selectors.instructions).toArray().map((e) => $(e).text().replace(/\s+/g, ' ').trim()).filter(Boolean) : [],
        tags: [],
        via: 'html',
      };
    }
  }
  return undefined;
}
