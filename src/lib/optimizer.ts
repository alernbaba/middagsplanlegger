/**
 * Ingrediensoptimalisering for ukeplanen.
 *
 * Poengsum (lavere er bedre):
 *   S = (1 - w) · Makro + w · Svinn + Straff − Bonus
 * der Makro er gjennomsnittlig avvik fra kalori- og makromål per middag, og Svinn er
 * hvor mye som blir til overs når hver vare rundes opp til hele pakninger.
 *
 * Søk: grådig utvalg dag for dag, deretter lokal forbedring (bytt én dag, bytt om to dager)
 * til ingen endring hjelper eller tidsgrensen er nådd.
 */
import type { IngredientInfo, Recipe } from '../../shared/types.ts';
import { packRound } from './shopping.ts';
import { dinnerTarget, energyPercent, preferredCategory, recipeAllowed, targetMacroPercent } from './targets.ts';
import type { Day, PlanDay, Settings } from './types.ts';

export interface OptimizerInput {
  recipes: Recipe[];
  ingredients: Record<string, IngredientInfo>;
  settings: Settings;
  days: PlanDay[];
  favorites: Set<string>;
  /** Stjerner 1–5. Høyt vurderte foreslås oftere, lavt vurderte sjeldnere. */
  ratings?: Record<string, number>;
  /** Skjulte oppskrifter foreslås aldri. */
  hidden?: Set<string>;
  /** Oppskrifter brukt de siste to ukene. */
  recent: Set<string>;
  /** Varer brukeren har hjemme (teller ikke som svinn). */
  atHome: Record<string, boolean>;
  timeBudgetMs?: number;
  random?: () => number;
}

interface Cand {
  r: Recipe;
  /** Behov per porsjon i kjøpsenhet, bare varer som kan gi svinn. */
  needs: [string, number][];
  kcal: number;
  macroDist: number;
  bonus: number;
}

interface Slot {
  day: Day;
  index: number;
  cookServings: number;
  kcalTarget: number;
  locked: boolean;
}

const VARIETY_PENALTY = 0.6;
const RECENT_PENALTY = 0.5;
/** Bonus per stjerne over (eller trekk under) tre stjerner. */
const RATING_STEP = 0.07;
const WASTE_SCALE = 0.35;

export class Optimizer {
  private cands: Cand[] = [];
  private byId = new Map<string, Cand>();
  private byIngredient = new Map<string, Cand[]>();
  private slots: Slot[] = [];
  private w: number;
  private rand: () => number;
  private wasteWeight = new Map<string, number>();

  constructor(private input: OptimizerInput) {
    const { settings, ingredients, favorites, atHome } = input;
    this.w = settings.wasteWeight;
    this.rand = input.random ?? Math.random;
    const target = targetMacroPercent(settings);
    const names = Object.fromEntries(Object.entries(ingredients).map(([id, i]) => [id, i.name]));
    const prefer = preferredCategory(settings);

    for (const [id, info] of Object.entries(ingredients)) {
      const home = atHome[id] ?? info.basis;
      if (home) continue;
      // Ferskvarer teller fullt, tørrvarer lite og krydder nesten ikke.
      this.wasteWeight.set(id, info.dept === 'krydder' ? 0.05 : info.perishable ? 1 : 0.25);
    }

    for (const r of input.recipes) {
      if (input.hidden?.has(r.id) || !recipeAllowed(r, settings, names)) continue;
      const ep = energyPercent(r.perServing);
      const macroDist = (Math.abs(ep.protein - target.protein) + Math.abs(ep.fat - target.fat) + Math.abs(ep.carbs - target.carbs)) / 200;
      const needs = new Map<string, number>();
      for (const ing of r.ingredients) {
        if (!ing.id || ing.buyAmount === undefined || !this.wasteWeight.has(ing.id)) continue;
        needs.set(ing.id, (needs.get(ing.id) ?? 0) + ing.buyAmount / r.servings);
      }
      let bonus = 0;
      if (settings.preferFavorites && favorites.has(r.id)) bonus += 0.15;
      const stars = input.ratings?.[r.id];
      if (stars) bonus += (stars - 3) * RATING_STEP;
      if (prefer && r.categories.includes(prefer)) bonus += 0.05;
      if (settings.filippinsk === 'ofte' && r.categories.includes('filippinsk')) bonus += 0.15;
      if (r.uncertain) bonus -= 0.05;
      if (settings.avoidRecent && input.recent.has(r.id)) bonus -= RECENT_PENALTY;
      const c: Cand = { r, needs: [...needs], kcal: r.perServing.kcal, macroDist, bonus };
      this.cands.push(c);
      this.byId.set(r.id, c);
      for (const [id] of c.needs) {
        if (!this.byIngredient.has(id)) this.byIngredient.set(id, []);
        this.byIngredient.get(id)!.push(c);
      }
    }

    input.days.forEach((d, index) => {
      if (d.leftoverFrom) return;
      const consumers = input.days.filter((x) => x.leftoverFrom === d.day);
      const servingDays = [d, ...consumers];
      const cookServings = servingDays.reduce((s, x) => s + x.servings, 0);
      // Kalorimålet er snittet av dagene som spiser måltidet, vektet med porsjoner.
      const kcalTarget = servingDays.reduce((s, x) => s + dinnerTarget(settings, x.day).kcal * x.servings, 0) / Math.max(1, cookServings);
      this.slots.push({ day: d.day, index, cookServings, kcalTarget, locked: d.locked && !!d.recipeId });
    });
  }

  get candidateCount() {
    return this.cands.length;
  }

  private fit(c: Cand, s: Slot): number {
    return Math.min(1.5, Math.abs(c.kcal - s.kcalTarget) / s.kcalTarget) * 0.6 + c.macroDist * 1.4;
  }

  /** Total poengsum for en tilordning (slot-indeks → kandidat). */
  score(assign: (Cand | null)[]): number {
    let fit = 0;
    let bonus = 0;
    let n = 0;
    const need = new Map<string, number>();
    assign.forEach((c, i) => {
      if (!c) return;
      const s = this.slots[i];
      n++;
      fit += this.fit(c, s);
      bonus += c.bonus;
      for (const [id, a] of c.needs) need.set(id, (need.get(id) ?? 0) + a * s.cookServings);
    });
    if (!n) return 0;
    let waste = 0;
    for (const [id, a] of need) {
      const info = this.input.ingredients[id];
      const pack = packRound(a, info.packages);
      const smallest = Math.min(...info.packages);
      waste += (Math.max(0, pack.total - a) / smallest) * (this.wasteWeight.get(id) ?? 0);
    }
    // Variasjon: samme hovedprotein mer enn to dager på rad.
    let penalty = 0;
    let run = 0;
    let prev = '';
    for (let i = 0; i < assign.length; i++) {
      const p = assign[i]?.r.mainProtein ?? '';
      run = p && p === prev ? run + 1 : 1;
      if (p && run > 2) penalty += VARIETY_PENALTY;
      prev = p;
    }
    return ((1 - this.w) * fit + this.w * waste * WASTE_SCALE + penalty - bonus) / n;
  }

  private topByFit(slot: Slot, k: number, exclude: Set<string>): Cand[] {
    return this.cands
      .filter((c) => !exclude.has(c.r.id))
      .map((c) => ({ c, f: this.fit(c, slot) - c.bonus }))
      .sort((a, b) => a.f - b.f)
      .slice(0, k)
      .map((x) => x.c);
  }

  /** Kandidater som deler varer med resten av planen. */
  private sharing(assign: (Cand | null)[], skip: number, k: number, exclude: Set<string>): Cand[] {
    const count = new Map<Cand, number>();
    assign.forEach((c, i) => {
      if (!c || i === skip) return;
      for (const [id] of c.needs) {
        if ((this.wasteWeight.get(id) ?? 0) < 0.2) continue;
        for (const o of this.byIngredient.get(id) ?? []) if (!exclude.has(o.r.id)) count.set(o, (count.get(o) ?? 0) + 1);
      }
    });
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([c]) => c);
  }

  private pool(assign: (Cand | null)[], i: number): Cand[] {
    const used = new Set(assign.filter((c, j) => c && j !== i).map((c) => c!.r.id));
    const set = new Set([...this.topByFit(this.slots[i], 60, used), ...this.sharing(assign, i, 60, used)]);
    return [...set];
  }

  /** Lager en plan. Låste dager beholdes. */
  run(): PlanDay[] {
    const start = performance.now();
    const budget = this.input.timeBudgetMs ?? 150;
    const assign: (Cand | null)[] = this.slots.map((s) => {
      const d = this.input.days[s.index];
      return s.locked && d.recipeId ? this.byId.get(d.recipeId) ?? this.lockedCand(d.recipeId) : null;
    });

    // 1. Grådig: fyll ledige dager én etter én, med litt tilfeldighet blant de beste.
    const order = this.slots.map((_, i) => i).filter((i) => !assign[i]);
    for (const i of order) {
      const scored = this.pool(assign, i)
        .map((c) => {
          assign[i] = c;
          return { c, s: this.score(assign) };
        })
        .sort((a, b) => a.s - b.s);
      assign[i] = null;
      if (!scored.length) continue;
      const top = scored.slice(0, 3);
      const pick = top[Math.floor(this.rand() * top.length)];
      assign[i] = pick.c;
    }

    // 2. Lokal forbedring.
    let current = this.score(assign);
    let improved = true;
    while (improved && performance.now() - start < budget) {
      improved = false;
      const free = order.filter((i) => assign[i]);
      for (const i of shuffle(free, this.rand)) {
        if (performance.now() - start > budget) break;
        const old = assign[i];
        let best = { c: old, s: current };
        for (const c of this.pool(assign, i)) {
          assign[i] = c;
          const s = this.score(assign);
          if (s < best.s - 1e-9) best = { c, s };
        }
        assign[i] = best.c;
        if (best.c !== old) {
          current = best.s;
          improved = true;
        }
      }
      // Bytt om to ledige dager (påvirker kalorimål og variasjon).
      for (let a = 0; a < free.length; a++) {
        for (let b = a + 1; b < free.length; b++) {
          const i = free[a];
          const j = free[b];
          [assign[i], assign[j]] = [assign[j], assign[i]];
          const s = this.score(assign);
          if (s < current - 1e-9) {
            current = s;
            improved = true;
          } else {
            [assign[i], assign[j]] = [assign[j], assign[i]];
          }
        }
      }
    }

    return this.toDays(assign);
  }

  /** Forslag til erstatning for én dag, beste først. */
  alternatives(dayIndex: number, k = 6): { recipe: Recipe; score: number }[] {
    const assign = this.currentAssign();
    const i = this.slots.findIndex((s) => s.index === dayIndex);
    if (i < 0) return [];
    const currentId = assign[i]?.r.id;
    const used = new Set(assign.filter((c) => c).map((c) => c!.r.id));
    const res: { recipe: Recipe; score: number }[] = [];
    // Vurder de beste på makro og de som deler flest varer med resten av uken.
    const pool = new Set([...this.topByFit(this.slots[i], 250, used), ...this.sharing(assign, i, 150, used)]);
    for (const c of pool) {
      if (c.r.id === currentId) continue;
      assign[i] = c;
      res.push({ recipe: c.r, score: this.score(assign) });
    }
    return res.sort((a, b) => a.score - b.score).slice(0, k);
  }

  private currentAssign(): (Cand | null)[] {
    return this.slots.map((s) => {
      const id = this.input.days[s.index].recipeId;
      return id ? this.byId.get(id) ?? this.lockedCand(id) : null;
    });
  }

  /** Oppskrifter som er valgt manuelt, men som filteret ellers ville utelatt. */
  private lockedCand(id: string): Cand | null {
    const r = this.input.recipes.find((x) => x.id === id);
    if (!r) return null;
    const needs = new Map<string, number>();
    for (const ing of r.ingredients) {
      if (!ing.id || ing.buyAmount === undefined || !this.wasteWeight.has(ing.id)) continue;
      needs.set(ing.id, (needs.get(ing.id) ?? 0) + ing.buyAmount / r.servings);
    }
    const target = targetMacroPercent(this.input.settings);
    const ep = energyPercent(r.perServing);
    const macroDist = (Math.abs(ep.protein - target.protein) + Math.abs(ep.fat - target.fat) + Math.abs(ep.carbs - target.carbs)) / 200;
    const c: Cand = { r, needs: [...needs], kcal: r.perServing.kcal, macroDist, bonus: 0 };
    this.byId.set(id, c);
    return c;
  }

  private toDays(assign: (Cand | null)[]): PlanDay[] {
    const days = this.input.days.map((d) => ({ ...d }));
    this.slots.forEach((s, i) => {
      days[s.index].recipeId = assign[i]?.r.id ?? null;
    });
    return days;
  }

  /** Poengsum for planen slik den er nå (for visning). */
  currentScore(): number {
    return this.score(this.currentAssign());
  }
}

function shuffle<T>(a: T[], rand: () => number): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
