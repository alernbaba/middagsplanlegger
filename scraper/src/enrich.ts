import type { IngredientInfo, Nutrition, Recipe, RecipeIngredient } from '../../shared/types.ts';
import { classify } from './classify.ts';
import { gramsPerBuyUnit, type Dictionary } from './dictionary.ts';
import type { IngredientParser } from './ingredientParser.ts';
import type { MvtMatch } from './nutrition.ts';

const r1 = (n: number) => Math.round(n * 10) / 10;

export function emptyNutrition(): Nutrition {
  return { kcal: 0, protein: 0, fat: 0, carbs: 0 };
}

export interface EnrichContext {
  dict: Dictionary;
  parser: IngredientParser;
  mvt: Record<string, MvtMatch>;
  /** Teller for linjer som ikke kunne tolkes: tekst → antall. */
  unmatched: Map<string, number>;
}

/** Tolker ingredienslinjene og beregner næring, kategorier og allergener. */
export function enrichRecipe(
  base: Omit<Recipe, 'ingredients' | 'perServing' | 'uncertain' | 'matchedShare' | 'categories' | 'allergens' | 'mainProtein'>,
  rawLines: string[],
  ctx: EnrichContext,
): Recipe {
  const ingredients: RecipeIngredient[] = [];
  let relevant = 0;
  let matched = 0;
  const total = emptyNutrition();

  for (const raw of rawLines) {
    if (!raw.trim() || /^(til|for|saus|dressing|topping|tilbehør|servering)[^,]*:$/i.test(raw.trim())) continue;
    for (const line of ctx.parser.parse(raw)) {
      const ri: RecipeIngredient = { raw: line.raw };
      if (line.amount !== undefined) ri.amount = r1(line.amount);
      if (line.unit) ri.unit = line.unit;
      const d = line.id ? ctx.dict.ingredients[line.id] : undefined;
      if (d && line.id) {
        ri.id = line.id;
        const per100 = ctx.mvt[line.id]?.per100g;
        if (line.grams !== undefined && per100) {
          ri.grams = line.grams;
          ri.buyAmount = line.buyAmount;
          const f = line.grams / 100;
          ri.nutrition = { kcal: r1(per100.kcal * f), protein: r1(per100.protein * f), fat: r1(per100.fat * f), carbs: r1(per100.carbs * f) };
          for (const k of ['kcal', 'protein', 'fat', 'carbs'] as const) total[k] += ri.nutrition[k];
        }
        // Salt, pepper og vann uten mengde påvirker ikke næringen.
        const negligible = per100 ? per100.kcal < 10 || d.dept === 'krydder' : false;
        if (!negligible) {
          relevant++;
          if (line.grams !== undefined) matched++;
        }
      } else {
        relevant++;
        const key = line.name || line.raw.toLowerCase();
        ctx.unmatched.set(key, (ctx.unmatched.get(key) ?? 0) + 1);
      }
      ingredients.push(ri);
    }
  }

  const servings = base.servings > 0 ? base.servings : 4;
  const perServing: Nutrition = {
    kcal: Math.round(total.kcal / servings),
    protein: r1(total.protein / servings),
    fat: r1(total.fat / servings),
    carbs: r1(total.carbs / servings),
  };
  const matchedShare = relevant ? Math.round((matched / relevant) * 100) / 100 : 0;
  let uncertain = matchedShare < 0.85 || perServing.kcal < 150;
  if (base.siteNutrition?.kcal && perServing.kcal > 0) {
    const dev = Math.abs(perServing.kcal - base.siteNutrition.kcal) / base.siteNutrition.kcal;
    if (dev > 0.4) uncertain = true;
  }
  const cls = classify(ingredients, perServing, ctx.dict);
  return { ...base, servings, ingredients, perServing, uncertain, matchedShare, ...cls };
}

/** Bygger ingrediensoversikten appen trenger for ingrediensene som faktisk brukes. */
export function buildIngredientInfo(recipes: Recipe[], ctx: EnrichContext): Record<string, IngredientInfo> {
  const used = new Set<string>();
  for (const r of recipes) for (const i of r.ingredients) if (i.id) used.add(i.id);
  const out: Record<string, IngredientInfo> = {};
  for (const id of [...used].sort()) {
    const d = ctx.dict.ingredients[id];
    const m = ctx.mvt[id];
    out[id] = {
      name: d.name,
      dept: d.dept,
      buyUnit: d.buy,
      packages: d.packages,
      gramsPerUnit: gramsPerBuyUnit(d),
      perishable: d.perishable,
      basis: !!d.basis,
      per100g: m.per100g,
      nutritionSource: m.source,
      ...(m.source === 'matvaretabellen' ? { mvtName: m.foodName } : {}),
      ...(d.label ? { label: d.label } : {}),
    };
  }
  return out;
}
