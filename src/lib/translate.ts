import { useEffect, useState } from 'react';
import type { IngredientInfo, Recipe, RecipeIngredient } from '../../shared/types.ts';
import { formatCount, formatNumber } from './shopping.ts';

/**
 * Norsk visning av engelske oppskrifter. Ingrediensene oversettes via ordboken (norsk navn og metriske mål),
 * titler med nettleserens innebygde oversetter når den finnes, ellers med en enkel ordliste.
 */

const DESCRIPTORS: [RegExp, string][] = [
  [/finely chopped|minced/i, 'finhakket'],
  [/roughly chopped|coarsely chopped/i, 'grovhakket'],
  [/chopped/i, 'hakket'],
  [/thinly sliced/i, 'i tynne skiver'],
  [/sliced/i, 'i skiver'],
  [/diced|cubed|cut into cubes/i, 'i terninger'],
  [/cut into (?:serving|bite)/i, 'i serveringsbiter'],
  [/cut into strips|julienned/i, 'i strimler'],
  [/cut into wedges|quartered/i, 'i båter'],
  [/cut into/i, 'i biter'],
  [/peeled and deveined|deveined/i, 'renset'],
  [/peeled/i, 'skrelt'],
  [/crushed/i, 'knust'],
  [/grated|shredded/i, 'revet'],
  [/halved/i, 'halvert'],
  [/beaten/i, 'sammenpisket'],
  [/drained/i, 'avrent'],
  [/to taste/i, 'etter smak'],
  [/optional/i, 'valgfritt'],
  [/for garnish/i, 'til pynt'],
  [/for (?:deep )?frying/i, 'til steking'],
  [/for serving/i, 'til servering'],
];

/** Engelske og norske enheter → visning på norsk. `factor` regner om mengden. */
const UNIT_NO: Record<string, { unit: string; factor?: number; grams?: boolean }> = {
  kopp: { unit: 'dl', factor: 2.4 },
  quart: { unit: 'dl', factor: 9.46 },
  pint: { unit: 'dl', factor: 4.73 },
  lb: { unit: 'g', grams: true },
  oz: { unit: 'g', grams: true },
  tommel: { unit: 'bit' },
  tomme: { unit: 'bit' },
};

function formatQty(n: number, unit: string): string {
  if (unit === 'g' || unit === 'ml') return String(n >= 50 ? Math.round(n / 5) * 5 : Math.round(n));
  if (unit === 'dl' || unit === 'ss' || unit === 'ts') return formatNumber(Math.round(n * 4) / 4, 2);
  return formatCount(n);
}

/** Ingredienslinjen på norsk, skalert. Linjer ordboken ikke kjenner, vises på engelsk med enkel ordliste. */
export function norwegianIngredient(ing: RecipeIngredient, factor: number, ingredients: Record<string, IngredientInfo>): string {
  const info = ing.id ? ingredients[ing.id] : undefined;
  if (!info) return glossary(ing.raw);
  const name = info.name.toLowerCase();
  const extras = DESCRIPTORS.filter(([re]) => re.test(ing.raw)).map(([, no]) => no);
  const desc = [...new Set(extras)].slice(0, 2).join(', ');
  let qty = '';
  if (ing.amount !== undefined) {
    const map = ing.unit ? UNIT_NO[ing.unit] : undefined;
    if (map?.grams && ing.grams) qty = `${formatQty(ing.grams * factor, 'g')} g`;
    else if (map) qty = `${formatQty(ing.amount * factor * (map.factor ?? 1), map.unit)} ${map.unit}`;
    else qty = `${formatQty(ing.amount * factor, ing.unit ?? 'stk')}${ing.unit && ing.unit !== 'stk' ? ` ${ing.unit}` : ''}`;
    const container = ing.unit && ['tommel', 'tomme', 'boks', 'pakke', 'bunt', 'hode'].includes(ing.unit);
    // Hele stykker (f.eks. «1 whole chicken») får vekten i parentes, så det er lett å handle.
    const bigPiece = (!ing.unit || ing.unit === 'stk') && (ing.grams ?? 0) >= 300;
    if ((container || bigPiece) && ing.grams) qty += ` (ca. ${Math.round((ing.grams * factor) / 10) * 10} g)`;
  }
  return [qty, name].filter(Boolean).join(' ') + (desc ? `, ${desc}` : '');
}

// Lengste uttrykk først, så «fried rice» blir «stekt ris» før «rice» blir «ris».
const GLOSSARY: [string, string][] = [
  ['how to make', ''], ['how to cook', ''], ['recipe', ''], ['filipino style', 'filippinsk'], ['filipino-style', 'filippinsk'], ['pinoy style', 'filippinsk'],
  ['pork belly', 'svineside'], ['liver spread', 'leverpostei'], ['chicken feet', 'kyllingføtter'], ['killer', ''], ['ground pork', 'svinekjøttdeig'], ['ground beef', 'kjøttdeig'], ['chicken wings', 'kyllingvinger'], ['chicken liver', 'kyllinglever'],
  ['fried rice', 'stekt ris'], ['garlic rice', 'hvitløksris'], ['spring rolls', 'vårruller'], ['coconut milk', 'kokosmelk'], ['fish sauce', 'fiskesaus'],
  ['soy sauce', 'soyasaus'], ['oyster sauce', 'østerssaus'], ['bitter melon', 'bittermelon'], ['string beans', 'aspargesbønner'], ['green beans', 'grønne bønner'],
  ['sweet and sour', 'sursøt'], ['sweet potato', 'søtpotet'], ['bok choy', 'pak choi'], ['water spinach', 'vannspinat'], ['bell pepper', 'paprika'],
  ['milkfish', 'melkefisk'], ['shrimp paste', 'rekepasta'], ['egg noodles', 'eggnudler'], ['rice noodles', 'risnudler'], ['in coconut milk', 'i kokosmelk'],
  ['chicken', 'kylling'], ['pork', 'svin'], ['beef', 'storfe'], ['fish', 'fisk'], ['shrimp', 'reker'], ['prawns', 'reker'], ['squid', 'blekksprut'], ['crab', 'krabbe'],
  ['mussels', 'blåskjell'], ['tuna', 'tunfisk'], ['salmon', 'laks'], ['tilapia', 'tilapia'], ['egg', 'egg'], ['eggs', 'egg'], ['tofu', 'tofu'], ['liver', 'lever'],
  ['rice', 'ris'], ['noodles', 'nudler'], ['soup', 'suppe'], ['stew', 'gryte'], ['curry', 'curry'], ['salad', 'salat'], ['vegetables', 'grønnsaker'], ['vegetable', 'grønnsak'],
  ['fried', 'stekt'], ['deep-fried', 'frityrstekt'], ['grilled', 'grillet'], ['roasted', 'ovnsbakt'], ['braised', 'braisert'], ['steamed', 'dampet'], ['stir-fried', 'wokket'],
  ['stir fry', 'wok'], ['stir-fry', 'wok'], ['baked', 'bakt'], ['crispy', 'sprø'], ['creamy', 'kremet'], ['spicy', 'sterk'], ['sweet', 'søt'], ['sour', 'sur'], ['easy', 'enkel'],
  ['garlic', 'hvitløk'], ['ginger', 'ingefær'], ['onion', 'løk'], ['onions', 'løk'], ['tomato', 'tomat'], ['tomatoes', 'tomater'], ['coconut', 'kokos'], ['cabbage', 'kål'],
  ['potatoes', 'poteter'], ['potato', 'potet'], ['beans', 'bønner'], ['eggplant', 'aubergine'], ['spinach', 'spinat'], ['mushrooms', 'sopp'], ['corn', 'mais'], ['peas', 'erter'],
  ['pineapple', 'ananas'], ['lemongrass', 'sitrongress'], ['tamarind', 'tamarind'], ['sauce', 'saus'], ['gravy', 'saus'], ['milk', 'melk'], ['cheese', 'ost'], ['butter', 'smør'],
  ['with', 'med'], ['and', 'og'], ['in', 'i'], ['on', 'på'], ['the', ''], ['a', ''], ['style', ''], ['filipino', 'filippinsk'], ['homemade', 'hjemmelaget'], ['quick', 'rask'],
  ['cup', 'kopp'], ['cups', 'kopper'], ['tablespoon', 'ss'], ['tablespoons', 'ss'], ['teaspoon', 'ts'], ['teaspoons', 'ts'], ['pieces', 'stk'], ['piece', 'stk'],
];
const GLOSSARY_RE = new RegExp(
  `(?<![\\p{L}-])(${GLOSSARY.map(([en]) => en).sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}-])`,
  'giu',
);
const GLOSSARY_MAP = new Map(GLOSSARY.map(([en, no]) => [en, no]));

/** Ord-for-ord-oversettelse med ordliste. Filippinske rettnavn (adobo, sinigang …) beholdes. */
export function glossary(text: string): string {
  const out = text
    .replace(GLOSSARY_RE, (m) => GLOSSARY_MAP.get(m.toLowerCase()) ?? m)
    .replace(/\s+/g, ' ')
    .replace(/\s+([,)])/g, '$1')
    .replace(/^[\s,–-]+|[\s,–-]+$/g, '')
    .trim();
  return out ? out[0].toUpperCase() + out.slice(1) : text;
}

// ---- Nettleserens innebygde oversetter (Chrome 138+). Resultatet huskes i localStorage. ----

const CACHE_KEY = 'middagsplanlegger:oversettelser';
let cache: Record<string, string> | null = null;
function readCache(): Record<string, string> {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
  } catch {
    cache = {};
  }
  return cache!;
}
function writeCache(key: string, value: string) {
  const c = readCache();
  c[key] = value;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* fullt eller blokkert: bare minnet */
  }
}

interface BrowserTranslator {
  translate(text: string): Promise<string>;
}
let translatorPromise: Promise<BrowserTranslator | null> | null = null;
function browserTranslator(): Promise<BrowserTranslator | null> {
  if (translatorPromise) return translatorPromise;
  translatorPromise = (async () => {
    try {
      const T = (globalThis as unknown as { Translator?: { availability(o: object): Promise<string>; create(o: object): Promise<BrowserTranslator> } }).Translator;
      if (!T) return null;
      const opts = { sourceLanguage: 'en', targetLanguage: 'nb' };
      const a = await T.availability(opts);
      // «downloadable» krever et klikk fra brukeren, så bare ferdig nedlastede modeller brukes automatisk.
      return a === 'available' ? await T.create(opts) : null;
    } catch {
      return null;
    }
  })();
  return translatorPromise;
}

/** Norsk tittel for en oppskrift. Norske oppskrifter returneres uendret. */
export function useRecipeTitle(recipe: Recipe | undefined, enabled: boolean): { title: string; translated: boolean } {
  const foreign = !!recipe && !!recipe.language && recipe.language !== 'nb' && enabled;
  const key = recipe ? `${recipe.id}` : '';
  const [better, setBetter] = useState<string | undefined>(() => (foreign ? readCache()[key] : undefined));
  useEffect(() => {
    if (!foreign || !recipe) return;
    const cached = readCache()[key];
    if (cached) {
      setBetter(cached);
      return;
    }
    let alive = true;
    browserTranslator().then(async (t) => {
      if (!t) return;
      try {
        const res = (await t.translate(recipe.name)).trim();
        if (res && alive) {
          writeCache(key, res);
          setBetter(res);
        }
      } catch {
        /* behold ordlisteversjonen */
      }
    });
    return () => {
      alive = false;
    };
  }, [foreign, key, recipe]);
  if (!recipe) return { title: '', translated: false };
  if (!foreign) return { title: recipe.name, translated: false };
  return { title: better ?? glossary(recipe.name), translated: true };
}

/** Lenke som åpner originaloppskriften oversatt til norsk med Google Oversetter. */
export function translatedUrl(url: string): string {
  return `https://translate.google.com/translate?sl=auto&tl=no&u=${encodeURIComponent(url)}`;
}
