import type { Category, Nutrition, Recipe } from '../../shared/types.ts';
import type { Day, DietCategory, Macros, Settings } from './types.ts';

export const DIET_PRESETS: Record<DietCategory, { label: string; macros: Macros; require?: Category; prefer?: Category; description: string }> = {
  blandet: { label: 'Blandet/hverdag', macros: { protein: 20, fat: 35, carbs: 45 }, description: 'Vanlig norsk hverdagsmat uten spesielle krav.' },
  sunt: { label: 'Sunt', macros: { protein: 25, fat: 30, carbs: 45 }, prefer: 'sunt', description: 'Mye grønnsaker, moderat fett og kalorier.' },
  keto: { label: 'Keto', macros: { protein: 25, fat: 70, carbs: 5 }, require: 'lavkarbo', prefer: 'keto', description: 'Svært lite karbohydrater, mye fett.' },
  lavkarbo: { label: 'Lavkarbo', macros: { protein: 30, fat: 45, carbs: 25 }, require: 'lavkarbo', description: 'Under ca. 25 % av energien fra karbohydrater.' },
  vegetar: { label: 'Vegetar', macros: { protein: 18, fat: 35, carbs: 47 }, require: 'vegetar', description: 'Uten kjøtt og fisk.' },
  hoyprotein: { label: 'Høyprotein', macros: { protein: 35, fat: 30, carbs: 35 }, prefer: 'hoyprotein', description: 'Mye protein, f.eks. for trening.' },
  middelhav: { label: 'Middelhavskost', macros: { protein: 20, fat: 40, carbs: 40 }, prefer: 'middelhav', description: 'Fisk, belgfrukter, olivenolje og grønnsaker.' },
};

/** Ønsket energifordeling i prosent (summerer til 100). */
export function targetMacroPercent(s: Settings): Macros {
  if (s.dietMode === 'kategori') return DIET_PRESETS[s.dietCategory].macros;
  if (s.macroUnit === 'prosent') return s.macroPercent;
  const p = s.macroGrams.protein * 4;
  const f = s.macroGrams.fat * 9;
  const c = s.macroGrams.carbs * 4;
  const sum = p + f + c || 1;
  return { protein: (p / sum) * 100, fat: (f / sum) * 100, carbs: (c / sum) * 100 };
}

export function dailyKcal(s: Settings, day: Day): number {
  return s.calorieMode === 'lik' ? s.dailyKcal : s.dailyKcalPerDay[day] ?? s.dailyKcal;
}

/** Kalorimål for én middagsporsjon på en gitt dag. */
export function dinnerKcal(s: Settings, day: Day): number {
  return Math.round(dailyKcal(s, day) * s.dinnerShare);
}

/** Målet i gram for én middagsporsjon. */
export function dinnerTarget(s: Settings, day: Day): Nutrition {
  const kcal = dinnerKcal(s, day);
  const m = targetMacroPercent(s);
  return {
    kcal,
    protein: (kcal * m.protein) / 100 / 4,
    fat: (kcal * m.fat) / 100 / 9,
    carbs: (kcal * m.carbs) / 100 / 4,
  };
}

export function energyPercent(n: Nutrition): Macros {
  const p = n.protein * 4;
  const f = n.fat * 9;
  const c = n.carbs * 4;
  const sum = p + f + c || 1;
  return { protein: (p / sum) * 100, fat: (f / sum) * 100, carbs: (c / sum) * 100 };
}

export type Level = 'ok' | 'warn' | 'bad';

/** Avvik fra mål: grønt innenfor ±10 %, gult innenfor ±20 %, ellers rødt. */
export function deviationLevel(actual: number, target: number): Level {
  if (!target) return 'ok';
  const d = Math.abs(actual - target) / target;
  return d <= 0.1 ? 'ok' : d <= 0.2 ? 'warn' : 'bad';
}

export function deviationPct(actual: number, target: number): number {
  return target ? Math.round(((actual - target) / target) * 100) : 0;
}

/** Stemmer oppskriften med brukerens kosthold og begrensninger? */
export function recipeAllowed(r: Recipe, s: Settings, ingredientNames: Record<string, string>): boolean {
  if (r.perServing.kcal <= 0) return false;
  if (s.dietMode === 'kategori') {
    const req = DIET_PRESETS[s.dietCategory].require;
    if (req && !r.categories.includes(req)) return false;
  }
  if (s.allergies.some((a) => r.allergens.includes(a))) return false;
  if (s.maxTime && r.totalTime && r.totalTime > s.maxTime) return false;
  const dislikes = parseDislikes(s.dislikes);
  if (dislikes.length) {
    for (const ing of r.ingredients) {
      const text = `${ing.raw} ${ing.id ? ingredientNames[ing.id] ?? '' : ''}`.toLowerCase();
      if (dislikes.some((d) => text.includes(d))) return false;
    }
  }
  return true;
}

export function parseDislikes(s: string): string[] {
  return s
    .split(/[,\n;]/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x.length >= 2);
}

export function preferredCategory(s: Settings): Category | undefined {
  return s.dietMode === 'kategori' ? DIET_PRESETS[s.dietCategory].prefer : undefined;
}
