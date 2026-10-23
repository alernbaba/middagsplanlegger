import type { Department, IngredientInfo, Recipe } from '../../shared/types.ts';
import type { Day, PlanDay } from './types.ts';
import { DAY_NAMES } from './types.ts';

export const DEPARTMENTS: { id: Department; name: string }[] = [
  { id: 'frukt_gront', name: 'Frukt og grønt' },
  { id: 'kjott_fisk', name: 'Kjøtt og fisk' },
  { id: 'meieri', name: 'Meieri og egg' },
  { id: 'brod_bakevarer', name: 'Brød og bakevarer' },
  { id: 'torrvarer', name: 'Tørrvarer' },
  { id: 'hermetikk', name: 'Hermetikk' },
  { id: 'krydder', name: 'Krydder' },
  { id: 'frysevarer', name: 'Frysevarer' },
  { id: 'annet', name: 'Annet' },
];

/** Et måltid som lages: oppskrift + antall porsjoner inkludert rester. */
export interface Meal {
  day: Day;
  recipe: Recipe;
  /** Porsjoner som lages (egne + til restedager). */
  cookServings: number;
  /** Dager som spiser rester av dette måltidet. */
  leftoverDays: Day[];
}

export function mealsFromPlan(days: PlanDay[], recipes: Map<string, Recipe>): Meal[] {
  const meals: Meal[] = [];
  for (const d of days) {
    if (d.leftoverFrom || !d.recipeId) continue;
    const recipe = recipes.get(d.recipeId);
    if (!recipe) continue;
    const consumers = days.filter((x) => x.leftoverFrom === d.day);
    meals.push({
      day: d.day,
      recipe,
      cookServings: d.servings + consumers.reduce((s, x) => s + x.servings, 0),
      leftoverDays: consumers.map((x) => x.day),
    });
  }
  return meals;
}

export interface PackResult {
  total: number;
  packs: { size: number; count: number }[];
}

/** Billigste kombinasjon av pakninger som dekker behovet (minst til overs, deretter færrest pakker). */
export function packRound(need: number, packages: number[]): PackResult {
  if (need <= 0) return { total: 0, packs: [] };
  // Litt slingringsmonn så 2,02 paprika ikke blir 3.
  const eff = need * 0.97;
  const sizes = [...new Set(packages.filter((p) => p > 0))].sort((a, b) => b - a);
  if (sizes.length === 0) return { total: need, packs: [] };
  let best: { total: number; n: number; counts: number[] } | undefined;
  const counts = new Array(sizes.length).fill(0);
  const rec = (i: number, sum: number, n: number) => {
    if (sum >= eff) {
      if (!best || sum < best.total - 1e-9 || (Math.abs(sum - best.total) < 1e-9 && n < best.n)) best = { total: sum, n, counts: [...counts] };
      return;
    }
    if (i >= sizes.length) return;
    const maxCount = Math.ceil((eff - sum) / sizes[i]);
    for (let c = i === sizes.length - 1 ? maxCount : 0; c <= maxCount; c++) {
      counts[i] = c;
      rec(i + 1, sum + c * sizes[i], n + c);
    }
    counts[i] = 0;
  };
  rec(0, 0, 0);
  const b = best!;
  return { total: b.total, packs: sizes.map((size, i) => ({ size, count: b.counts[i] })).filter((p) => p.count > 0) };
}

export interface ShoppingItem {
  key: string;
  id?: string;
  name: string;
  dept: Department;
  /** Behov i kjøpsenhet (undefined = "etter behov"). */
  need?: number;
  buy?: PackResult;
  leftover?: number;
  info?: IngredientInfo;
  /** Hvilke dager varen brukes. */
  days: Day[];
  /** For linjer som ikke kunne tolkes. */
  rawLines?: string[];
}

/** Summerer ingrediensbehovet for alle måltider i kjøpsenhet. */
export function computeNeeds(meals: Meal[]): Map<string, { need: number; hasAmount: boolean; days: Set<Day> }> {
  const needs = new Map<string, { need: number; hasAmount: boolean; days: Set<Day> }>();
  for (const m of meals) {
    const factor = m.cookServings / m.recipe.servings;
    for (const ing of m.recipe.ingredients) {
      if (!ing.id) continue;
      const e = needs.get(ing.id) ?? { need: 0, hasAmount: false, days: new Set<Day>() };
      if (ing.buyAmount !== undefined) {
        e.need += ing.buyAmount * factor;
        e.hasAmount = true;
      }
      e.days.add(m.day);
      needs.set(ing.id, e);
    }
  }
  return needs;
}

export function buildShoppingList(meals: Meal[], ingredients: Record<string, IngredientInfo>): ShoppingItem[] {
  const items: ShoppingItem[] = [];
  for (const [id, e] of computeNeeds(meals)) {
    const info = ingredients[id];
    if (!info) continue;
    const item: ShoppingItem = { key: id, id, name: info.name, dept: info.dept, info, days: [...e.days] };
    if (e.hasAmount && e.need > 0) {
      item.need = e.need;
      item.buy = packRound(e.need, info.packages);
      item.leftover = Math.max(0, item.buy.total - e.need);
    }
    items.push(item);
  }
  // Linjer som ikke kunne tolkes, vises under "Annet" med originalteksten.
  const raw = new Map<string, ShoppingItem>();
  for (const m of meals) {
    m.recipe.ingredients.forEach((ing) => {
      if (ing.id) return;
      const key = `raw:${ing.raw.toLowerCase()}`;
      const it = raw.get(key) ?? { key, name: ing.raw, dept: 'annet' as Department, days: [], rawLines: [] };
      it.days.push(m.day);
      const f = m.cookServings / m.recipe.servings;
      it.rawLines!.push(f === 1 ? `${m.recipe.name}` : `${m.recipe.name} (×${formatNumber(f)})`);
      raw.set(key, it);
    });
  }
  items.push(...raw.values());
  return items.sort((a, b) => a.name.localeCompare(b.name, 'nb'));
}

export function formatNumber(n: number, maxDecimals = 1): string {
  const r = Math.round(n * 10 ** maxDecimals) / 10 ** maxDecimals;
  return r.toLocaleString('nb-NO', { maximumFractionDigits: maxDecimals });
}

const FRACTIONS: [number, string][] = [[0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']];

export function formatCount(n: number): string {
  const whole = Math.floor(n + 1e-6);
  const frac = n - whole;
  if (frac < 0.08) return String(whole);
  if (frac > 0.92) return String(whole + 1);
  const f = FRACTIONS.reduce((a, b) => (Math.abs(b[0] - frac) < Math.abs(a[0] - frac) ? b : a));
  return whole ? `${whole} ${f[1]}` : f[1];
}

/** Viser en mengde i kjøpsenheten, f.eks. "800 g", "1,5 l", "3 stk". */
export function formatAmount(amount: number, info: IngredientInfo): string {
  if (info.buyUnit === 'g') {
    if (amount >= 1000) return `${formatNumber(amount / 1000, 2)} kg`;
    return `${Math.round(amount)} g`;
  }
  if (info.buyUnit === 'ml') {
    if (amount >= 1000) return `${formatNumber(amount / 1000, 2)} l`;
    if (amount >= 100) return `${formatNumber(amount / 100, 1)} dl`;
    return `${Math.round(amount)} ml`;
  }
  const [one, many] = info.label ?? ['stk', 'stk'];
  return `${formatCount(amount)} ${amount > 1.08 ? many : one}`;
}

/** Hva som skal kjøpes, f.eks. "2 × 400 g" eller "3 stk". */
export function formatBuy(item: ShoppingItem): string {
  if (!item.buy || !item.info) return 'etter behov';
  const info = item.info;
  if (info.buyUnit === 'stk') return formatAmount(item.buy.total, info);
  const parts = item.buy.packs.map((p) => (p.count > 1 ? `${p.count} × ${formatAmount(p.size, info)}` : formatAmount(p.size, info)));
  return parts.join(' + ') || formatAmount(item.buy.total, info);
}

export function formatLeftover(item: ShoppingItem): string | undefined {
  if (!item.info || !item.leftover) return undefined;
  const info = item.info;
  // Ignorer små rester som bare er avrunding.
  const minimum = info.buyUnit === 'stk' ? 0.15 : Math.max(10, Math.min(...info.packages) * 0.05);
  if (item.leftover < minimum) return undefined;
  if (info.buyUnit !== 'stk') {
    const rounded = info.buyUnit === 'g' ? Math.round(item.leftover / 10) * 10 : Math.round(item.leftover / 10) * 10;
    return formatAmount(rounded, info);
  }
  return formatAmount(item.leftover, info);
}

export function isAtHome(item: ShoppingItem, atHome: Record<string, boolean>): boolean {
  const v = atHome[item.key];
  if (v !== undefined) return v;
  return !!item.info?.basis;
}

export function shoppingListText(items: ShoppingItem[], atHome: Record<string, boolean>, checked: Record<string, boolean>, title: string): string {
  const lines = [title, ''];
  for (const dept of DEPARTMENTS) {
    const its = items.filter((i) => i.dept === dept.id && !isAtHome(i, atHome) && !checked[i.key]);
    if (!its.length) continue;
    lines.push(dept.name);
    for (const i of its) lines.push(i.rawLines ? `- ${i.name}` : `- ${i.name}: ${formatBuy(i)}`);
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

export function dayList(days: Day[]): string {
  return days.map((d) => DAY_NAMES[d].toLowerCase()).join(', ');
}

/** Ingredienser (ikke basisvarer) som et måltid deler med andre måltider i uken. */
export function sharedIngredients(meal: Meal, meals: Meal[], ingredients: Record<string, IngredientInfo>): { id: string; name: string; days: Day[] }[] {
  const out: { id: string; name: string; days: Day[] }[] = [];
  const ids = new Set(meal.recipe.ingredients.map((i) => i.id).filter((x): x is string => !!x));
  for (const id of ids) {
    const info = ingredients[id];
    if (!info || info.basis || info.dept === 'krydder') continue;
    const days = meals.filter((m) => m !== meal && m.recipe.ingredients.some((i) => i.id === id)).map((m) => m.day);
    if (days.length) out.push({ id, name: info.name, days });
  }
  return out;
}
