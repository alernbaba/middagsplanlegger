import type { RecipeData } from './data.ts';
import { Optimizer } from './optimizer.ts';
import { mondayOf, newId, recentRecipeIds } from './storage.ts';
import { DAYS, type Day, type PlanDay, type Settings, type UserData, type WeekPlan } from './types.ts';

const order = (d: Day) => DAYS.indexOf(d);

/** Gyldige restekoblinger: begge dager er valgt, restene spises senere, og ingen kjeder. */
export function validLeftovers(s: Settings): { from: Day; to: Day }[] {
  const out: { from: Day; to: Day }[] = [];
  for (const l of s.leftovers) {
    if (!s.days.includes(l.from) || !s.days.includes(l.to)) continue;
    if (order(l.to) <= order(l.from)) continue;
    if (out.some((o) => o.to === l.to || o.to === l.from || o.from === l.to)) continue;
    out.push(l);
  }
  return out;
}

/** Lager dagene i planen ut fra innstillingene, og beholder oppskrifter fra en eksisterende plan. */
export function planSkeleton(s: Settings, existing?: PlanDay[], keepUnlocked = true): PlanDay[] {
  const leftovers = validLeftovers(s);
  return [...s.days]
    .sort((a, b) => order(a) - order(b))
    .map((day) => {
      const prev = existing?.find((d) => d.day === day);
      const lf = leftovers.find((l) => l.to === day);
      if (lf) return { day, servings: s.servings[day] ?? 2, recipeId: null, locked: false, leftoverFrom: lf.from };
      const keep = prev && !prev.leftoverFrom && (prev.locked || keepUnlocked);
      return { day, servings: s.servings[day] ?? 2, recipeId: keep ? prev.recipeId : null, locked: keep ? prev.locked : false };
    });
}

export function makeOptimizer(data: UserData, rd: RecipeData, days: PlanDay[], weekStart: string, planId?: string) {
  return new Optimizer({
    recipes: rd.file.recipes,
    ingredients: rd.file.ingredients,
    settings: data.settings,
    days,
    favorites: new Set(data.favorites),
    ratings: data.ratings,
    hidden: new Set(data.hidden),
    recent: recentRecipeIds(data.history, weekStart, planId),
    atHome: data.atHome,
  });
}

/** Genererer (eller fyller ut) ukeplanen. Låste dager beholdes. */
export function generatePlan(data: UserData, rd: RecipeData): UserData {
  const thisWeek = mondayOf();
  let current = data.currentPlan;
  let history = data.history;
  // Ny uke: arkiver forrige plan og start på nytt.
  if (current && current.weekStart < thisWeek) {
    history = upsertHistory(history, current);
    current = null;
  }
  const weekStart = current?.weekStart ?? thisWeek;
  const skeleton = planSkeleton(data.settings, current?.days, false);
  const opt = makeOptimizer(data, rd, skeleton, weekStart, current?.id);
  const days = opt.run();
  const plan: WeekPlan = { id: current?.id ?? newId(), createdAt: new Date().toISOString(), weekStart, days };
  return { ...data, currentPlan: plan, history };
}

export function upsertHistory(history: WeekPlan[], plan: WeekPlan): WeekPlan[] {
  if (!plan.days.some((d) => d.recipeId)) return history;
  const rest = history.filter((h) => h.id !== plan.id);
  return [{ ...plan }, ...rest].sort((a, b) => b.weekStart.localeCompare(a.weekStart) || b.createdAt.localeCompare(a.createdAt));
}

export function setDay(data: UserData, day: Day, patch: Partial<PlanDay>): UserData {
  if (!data.currentPlan) return data;
  return {
    ...data,
    currentPlan: { ...data.currentPlan, days: data.currentPlan.days.map((d) => (d.day === day ? { ...d, ...patch } : d)) },
  };
}

/** Sørger for at det finnes en plan som følger innstillingene (uten å velge oppskrifter). */
export function ensurePlan(data: UserData): WeekPlan {
  if (data.currentPlan) return { ...data.currentPlan, days: planSkeleton(data.settings, data.currentPlan.days) };
  return { id: newId(), createdAt: new Date().toISOString(), weekStart: mondayOf(), days: planSkeleton(data.settings) };
}

/** Setter stjerner (1–5). Samme verdi en gang til fjerner vurderingen. */
export function rateRecipe(d: UserData, id: string, stars: number): UserData {
  const ratings = { ...d.ratings };
  if (ratings[id] === stars) delete ratings[id];
  else ratings[id] = stars;
  return { ...d, ratings };
}

/** Skjuler eller viser en oppskrift. En skjult oppskrift fjernes også fra favorittene. */
export function toggleHidden(d: UserData, id: string): UserData {
  if (d.hidden.includes(id)) return { ...d, hidden: d.hidden.filter((h) => h !== id) };
  return { ...d, hidden: [...d.hidden, id], favorites: d.favorites.filter((f) => f !== id) };
}
