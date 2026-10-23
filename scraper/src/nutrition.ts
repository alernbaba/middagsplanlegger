import fs from 'node:fs';
import path from 'node:path';
import type { Nutrition } from '../../shared/types.ts';
import type { Dictionary } from './dictionary.ts';

export const MVT_URL = 'https://www.matvaretabellen.no/api/nb/foods.json';

export interface MvtFood {
  foodId: string;
  foodName: string;
  per100g: Nutrition;
}

interface RawFood {
  foodId: string;
  foodName: string;
  calories?: { quantity?: number };
  constituents?: { nutrientId: string; quantity?: number }[];
}

export function parseMvt(json: unknown): MvtFood[] {
  const foods = ((json as { foods?: RawFood[] })?.foods ?? []) as RawFood[];
  return foods
    .filter((f) => f.foodId && f.foodName)
    .map((f) => {
      const c = (id: string) => f.constituents?.find((x) => x.nutrientId === id)?.quantity ?? 0;
      return {
        foodId: f.foodId,
        foodName: f.foodName,
        per100g: { kcal: f.calories?.quantity ?? 0, protein: c('Protein'), fat: c('Fett'), carbs: c('Karbo') },
      };
    });
}

/** Laster ned Matvaretabellen (med lokal hurtigbuffer). Returnerer tom liste hvis det feiler. */
export async function loadMvt(cacheFile: string, userAgent: string, log: (s: string) => void): Promise<MvtFood[]> {
  try {
    const res = await fetch(MVT_URL, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const foods = parseMvt(JSON.parse(text));
    if (foods.length < 100) throw new Error(`bare ${foods.length} matvarer`);
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, text);
    log(`Matvaretabellen: lastet ned ${foods.length} matvarer`);
    return foods;
  } catch (e) {
    log(`Matvaretabellen: nedlasting feilet (${(e as Error).message})`);
    if (fs.existsSync(cacheFile)) {
      const foods = parseMvt(JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
      log(`Matvaretabellen: bruker hurtigbuffer med ${foods.length} matvarer`);
      return foods;
    }
    log('Matvaretabellen: bruker reserveverdiene i ingredients.json');
    return [];
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[,()%]/g, ' ').replace(/\s+/g, ' ').trim();

/** Finner matvaren for et sett søkeord: alle ord må finnes, ord med - foran må ikke finnes. Korteste navn vinner. */
export function findMvtFood(foods: MvtFood[], query: string, id?: string): MvtFood | undefined {
  if (id) return foods.find((f) => f.foodId === id);
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return undefined;
  const inc = words.filter((w) => !w.startsWith('-'));
  const exc = words.filter((w) => w.startsWith('-')).map((w) => w.slice(1));
  let best: { f: MvtFood; score: number } | undefined;
  for (const f of foods) {
    const name = norm(f.foodName);
    const tokens = name.split(' ');
    if (!inc.every((w) => name.includes(w))) continue;
    if (exc.some((w) => name.includes(w))) continue;
    let score = name.length;
    if (!name.startsWith(inc[0])) score += 50;
    // Hele ord teller mer enn delord ("løk" i "hvitløk").
    score += inc.filter((w) => !tokens.includes(w)).length * 20;
    if (!best || score < best.score) best = { f, score };
  }
  return best?.f;
}

export interface MvtMatch {
  id: string;
  query: string;
  foodId?: string;
  foodName?: string;
  per100g: Nutrition;
  source: 'matvaretabellen' | 'ordbok';
}

/** Knytter hver ordbokvare til Matvaretabellen. */
export function matchDictionary(dict: Dictionary, foods: MvtFood[]): Record<string, MvtMatch> {
  const out: Record<string, MvtMatch> = {};
  for (const [id, ing] of Object.entries(dict.ingredients)) {
    const [kcal, protein, fat, carbs] = ing.n;
    const fallback = { kcal, protein, fat, carbs };
    const food = foods.length && (ing.mvt || ing.mvtId) ? findMvtFood(foods, ing.mvt, ing.mvtId) : undefined;
    // Sjekk at treffet er rimelig: stort avvik fra reserveverdien tyder på feil matvare.
    const plausible = food && (fallback.kcal === 0 || Math.abs(food.per100g.kcal - fallback.kcal) / Math.max(fallback.kcal, 40) < 0.6);
    out[id] = food && plausible
      ? { id, query: ing.mvt, foodId: food.foodId, foodName: food.foodName, per100g: food.per100g, source: 'matvaretabellen' }
      : { id, query: ing.mvt, foodId: food?.foodId, foodName: food ? `${food.foodName} (forkastet: ${food.per100g.kcal} kcal)` : undefined, per100g: fallback, source: 'ordbok' };
  }
  return out;
}
