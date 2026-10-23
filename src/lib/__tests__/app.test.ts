import { describe, expect, it } from 'vitest';
import type { IngredientInfo, Recipe, RecipeIngredient } from '../../../shared/types.ts';
import { adjustMacros } from '../../components/SettingsView.tsx';
import { Optimizer } from '../optimizer.ts';
import { planSkeleton } from '../plan.ts';
import { buildShoppingList, formatBuy, formatLeftover, mealsFromPlan, packRound } from '../shopping.ts';
import { defaultSettings } from '../storage.ts';
import { dinnerKcal } from '../targets.ts';

const info = (name: string, dept: IngredientInfo['dept'], buyUnit: IngredientInfo['buyUnit'], packages: number[], extra: Partial<IngredientInfo> = {}): IngredientInfo => ({
  name, dept, buyUnit, packages, gramsPerUnit: 1, perishable: true, basis: false, per100g: { kcal: 100, protein: 5, fat: 5, carbs: 10 }, nutritionSource: 'ordbok', ...extra,
});

const ingredients: Record<string, IngredientInfo> = {
  kjottdeig: info('Kjøttdeig', 'kjott_fisk', 'g', [400]),
  purre: info('Purre', 'frukt_gront', 'stk', [1], { gramsPerUnit: 250 }),
  romme: info('Rømme', 'meieri', 'g', [300]),
  laks: info('Laks', 'kjott_fisk', 'g', [250, 400]),
  salt: info('Salt', 'krydder', 'g', [500], { basis: true, perishable: false }),
  paprika: info('Paprika', 'frukt_gront', 'stk', [1], { gramsPerUnit: 200, label: ['stk', 'stk'] }),
};

let n = 0;
function recipe(name: string, ings: [string, number][], kcal: number, protein = 'storfe'): Recipe {
  const lines: RecipeIngredient[] = ings.map(([id, buyAmount]) => ({ raw: `${buyAmount} ${id}`, id, buyAmount, amount: buyAmount }));
  return {
    id: `r${n++}`, source: 'test', sourceName: 'Test', url: 'https://example.no', name, servings: 4, ingredients: lines,
    perServing: { kcal, protein: (kcal * 0.25) / 4, fat: (kcal * 0.35) / 9, carbs: (kcal * 0.4) / 4 },
    uncertain: false, matchedShare: 1, categories: [], allergens: [], mainProtein: protein, firstSeen: '', lastSeen: '',
  };
}

describe('pakninger', () => {
  it('runder opp til billigste kombinasjon', () => {
    expect(packRound(500, [400]).total).toBe(800);
    expect(packRound(600, [250, 400]).total).toBe(650);
    expect(packRound(2.02, [1]).total).toBe(2);
    expect(packRound(0.5, [1]).total).toBe(1);
  });
});

describe('handleliste', () => {
  it('slår sammen mengder og viser rester', () => {
    const a = recipe('Taco', [['kjottdeig', 200], ['purre', 0.5], ['salt', 5]], 600);
    const b = recipe('Gryte', [['kjottdeig', 300], ['purre', 0.5]], 600);
    const byId = new Map([a, b].map((r) => [r.id, r]));
    const days = [
      { day: 'man' as const, servings: 4, recipeId: a.id, locked: false },
      { day: 'tir' as const, servings: 4, recipeId: b.id, locked: false },
    ];
    const items = buildShoppingList(mealsFromPlan(days, byId), ingredients);
    const kd = items.find((i) => i.id === 'kjottdeig')!;
    expect(kd.need).toBe(500);
    expect(formatBuy(kd)).toBe('2 × 400 g');
    expect(formatLeftover(kd)).toBe('300 g');
    const purre = items.find((i) => i.id === 'purre')!;
    expect(purre.buy!.total).toBe(1);
    expect(formatLeftover(purre)).toBeUndefined();
  });

  it('skalerer med rester til en annen dag', () => {
    const a = recipe('Gryte', [['kjottdeig', 400]], 600);
    const days = [
      { day: 'man' as const, servings: 2, recipeId: a.id, locked: false },
      { day: 'tir' as const, servings: 2, recipeId: null, locked: false, leftoverFrom: 'man' as const },
    ];
    const meals = mealsFromPlan(days, new Map([[a.id, a]]));
    expect(meals[0].cookServings).toBe(4);
    expect(buildShoppingList(meals, ingredients)[0].need).toBe(400);
  });
});

describe('optimalisering', () => {
  const settings = { ...defaultSettings(), days: ['man', 'tir'] as const as never, servings: { ...defaultSettings().servings, man: 4, tir: 4 }, wasteWeight: 0.8, maxTime: null };
  const target = dinnerKcal(settings, 'man');

  it('velger oppskrifter som bruker resten av en halv purre og rømmebeger', () => {
    const halfLeek = recipe('Purresuppe', [['purre', 0.5], ['romme', 150]], target);
    const otherHalf = recipe('Purrepai', [['purre', 0.5], ['romme', 150]], target, 'egg');
    const unrelated = recipe('Paprikagryte', [['paprika', 1.5], ['laks', 300]], target, 'fisk');
    const opt = new Optimizer({
      recipes: [halfLeek, unrelated, otherHalf], ingredients, settings, favorites: new Set(), recent: new Set(), atHome: {},
      days: planSkeleton(settings), random: () => 0,
    });
    const ids = opt.run().map((d) => d.recipeId).sort();
    expect(ids).toEqual([halfLeek.id, otherHalf.id].sort());
  });

  it('beholder låste dager og bruker aldri samme oppskrift to ganger', () => {
    const rs = Array.from({ length: 10 }, (_, i) => recipe(`R${i}`, [['kjottdeig', 400]], target + i * 10));
    const days = planSkeleton(settings).map((d, i) => (i === 0 ? { ...d, recipeId: rs[5].id, locked: true } : d));
    const opt = new Optimizer({ recipes: rs, ingredients, settings, favorites: new Set(), recent: new Set(), atHome: {}, days });
    const res = opt.run();
    expect(res[0].recipeId).toBe(rs[5].id);
    expect(res[1].recipeId).not.toBe(rs[5].id);
    expect(opt.alternatives(1).every((a) => a.recipe.id !== rs[5].id)).toBe(true);
  });

  it('unngår samme hovedprotein mer enn to dager på rad', () => {
    const s = { ...settings, days: ['man', 'tir', 'ons'] as never, servings: { ...settings.servings, ons: 4 }, wasteWeight: 0 };
    const beef = [0, 1, 2].map((i) => recipe(`Biff ${i}`, [['kjottdeig', 400]], target));
    const fish = recipe('Laks', [['laks', 400]], target * 1.15, 'fisk');
    const opt = new Optimizer({ recipes: [...beef, fish], ingredients, settings: s, favorites: new Set(), recent: new Set(), atHome: {}, days: planSkeleton(s) });
    const proteins = opt.run().map((d) => [...beef, fish].find((r) => r.id === d.recipeId)!.mainProtein);
    expect(proteins).toContain('fisk');
  });

  it('er rask nok med mange oppskrifter', () => {
    const ids = Object.keys(ingredients).filter((i) => i !== 'salt');
    const many = Array.from({ length: 3000 }, (_, i) => recipe(`R${i}`, [[ids[i % ids.length], 1 + (i % 3)], [ids[(i * 7) % ids.length], 1]], 400 + (i % 600), ['storfe', 'fisk', 'kylling'][i % 3]));
    const s = { ...settings, days: ['man', 'tir', 'ons', 'tor', 'fre', 'lor', 'son'] as never };
    const t = performance.now();
    const res = new Optimizer({ recipes: many, ingredients, settings: s, favorites: new Set(), recent: new Set(), atHome: {}, days: planSkeleton(s), timeBudgetMs: 150 }).run();
    expect(performance.now() - t).toBeLessThan(1500);
    expect(new Set(res.map((d) => d.recipeId)).size).toBe(7);
  });
});

describe('makroer', () => {
  it('summerer alltid til 100 %', () => {
    const m = adjustMacros({ protein: 25, fat: 35, carbs: 40 }, 'protein', 40);
    expect(m.protein + m.fat + m.carbs).toBe(100);
    expect(m.protein).toBe(40);
    const z = adjustMacros({ protein: 100, fat: 0, carbs: 0 }, 'protein', 50);
    expect(z).toEqual({ protein: 50, fat: 25, carbs: 25 });
  });
});
