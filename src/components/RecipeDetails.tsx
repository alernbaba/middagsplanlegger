import type { IngredientInfo, Nutrition, Recipe, RecipeIngredient } from '../../shared/types.ts';
import { formatCount, formatKr, formatNumber, PRICE_STORE_NAMES, PRICE_STORES, recipeCost } from '../lib/shopping.ts';
import { deviationLevel, deviationPct } from '../lib/targets.ts';
import { norwegianIngredient, translatedUrl, useRecipeTitle } from '../lib/translate.ts';
import { DAY_NAMES, type Day } from '../lib/types.ts';
import { Badge, Icon, levelText } from './ui.tsx';

const LEAD_NUM = /^\s*(?:ca\.?\s*)?(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔])(?:\s*(?:-|–|til)\s*(\d+(?:[.,]\d+)?))?/i;
const CONTAINER = new Set(['boks', 'pakke', 'pose', 'glass', 'flaske', 'beger', 'kartong', 'tube', 'neve', 'bunt', 'potte']);

function formatQty(n: number, unit?: string): string {
  if (unit === 'g' || unit === 'ml') return String(n >= 50 ? Math.round(n / 5) * 5 : Math.round(n));
  if (!unit || ['stk', 'boks', 'pakke', 'fedd', 'bunt', 'beger', 'potte', 'pose', 'glass', 'neve', 'skive'].includes(unit)) return formatCount(n);
  return formatNumber(n, 1);
}

/** Ingredienslinjen med mengden skalert til antall porsjoner. */
export function scaledLine(ing: RecipeIngredient, factor: number): string {
  let text = ing.raw;
  if (ing.amount !== undefined && Math.abs(factor - 1) > 0.01 && LEAD_NUM.test(text)) {
    text = text.replace(LEAD_NUM, formatQty(ing.amount * factor, ing.unit));
  }
  if (ing.unit && CONTAINER.has(ing.unit) && ing.grams && !/\(\s*[\d.,]+\s*g/.test(ing.raw)) {
    text += ` (ca. ${Math.round((ing.grams * factor) / 5) * 5} g)`;
  }
  return text;
}

export function NutritionTable({ actual, target }: { actual: Nutrition; target: Nutrition }) {
  const rows: { key: keyof Nutrition; label: string; unit: string }[] = [
    { key: 'kcal', label: 'Energi', unit: 'kcal' },
    { key: 'protein', label: 'Protein', unit: 'g' },
    { key: 'fat', label: 'Fett', unit: 'g' },
    { key: 'carbs', label: 'Karbohydrater', unit: 'g' },
  ];
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-stone-500">
          <th className="py-1 font-medium">Per porsjon</th>
          <th className="py-1 text-right font-medium">Oppskrift</th>
          <th className="py-1 text-right font-medium">Mål</th>
          <th className="py-1 text-right font-medium">Avvik</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const a = actual[r.key];
          const t = target[r.key];
          const level = deviationLevel(a, t);
          const pct = deviationPct(a, t);
          return (
            <tr key={r.key} className="border-t border-stone-100">
              <td className="py-1.5">{r.label}</td>
              <td className="py-1.5 text-right tabular-nums">
                {Math.round(a)} {r.unit}
              </td>
              <td className="py-1.5 text-right tabular-nums text-stone-500">
                {Math.round(t)} {r.unit}
              </td>
              <td className="py-1.5 text-right">
                <Badge level={level} title={levelText[level]}>
                  {pct > 0 ? '+' : ''}
                  {pct} %
                </Badge>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Omtrentlig pris per porsjon i hver butikk, for mengden oppskriften bruker. */
function RecipePrice({ recipe, ingredients }: { recipe: Recipe; ingredients: Record<string, IngredientInfo> }) {
  const costs = PRICE_STORES.map((s) => ({ s, c: recipeCost(recipe, ingredients, s) })).filter((x) => x.c);
  if (!costs.length) return null;
  const share = Math.min(...costs.map((x) => x.c!.share));
  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold">Pris per porsjon</h4>
      <p className="text-sm tabular-nums">
        {costs.map((x, i) => (
          <span key={x.s}>
            {i > 0 && ' · '}
            {PRICE_STORE_NAMES[x.s]} ca. {formatKr(x.c!.perServing)}
          </span>
        ))}
      </p>
      <p className="mt-1 text-xs text-stone-500">
        Det oppskriften bruker, uten basisvarer{share < 1 ? `. ${Math.round((1 - share) * 100)} % av varene mangler pris` : ''}.
      </p>
    </div>
  );
}

/** Tittelen, oversatt til norsk for engelske oppskrifter når innstillingen er på. */
export function RecipeTitle({ recipe, translate }: { recipe: Recipe; translate: boolean }) {
  const { title, translated } = useRecipeTitle(recipe, translate);
  return (
    <>
      {title}
      {translated ? (
        <span className="ml-1.5 inline-block rounded bg-sky-50 px-1 align-middle text-[10px] font-medium uppercase text-sky-700 ring-1 ring-sky-100" title={`Oversatt fra engelsk: ${recipe.name}`}>
          oversatt
        </span>
      ) : recipe.language && recipe.language !== 'nb' ? (
        <span className="ml-1.5 inline-block rounded bg-stone-100 px-1 align-middle text-[10px] font-medium uppercase text-stone-600">{recipe.language}</span>
      ) : null}
    </>
  );
}

interface Props {
  recipe: Recipe;
  /** Vis engelske oppskrifter på norsk. */
  translate?: boolean;
  servings: number;
  target: Nutrition;
  ingredients: Record<string, IngredientInfo>;
  shared?: { id: string; name: string; days: Day[] }[];
  leftoverDays?: Day[];
}

export function RecipeDetails({ recipe, servings, target, ingredients, shared, leftoverDays, translate = false }: Props) {
  const factor = servings / recipe.servings;
  const foreign = !!recipe.language && recipe.language !== 'nb';
  const norsk = foreign && translate;
  return (
    <div className="space-y-4">
      {recipe.uncertain && (
        <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
          <Icon name="info" className="h-4 w-4 shrink-0" />
          Usikker næringsberegning: {Math.round(recipe.matchedShare * 100)} % av ingrediensene kunne tolkes.
          {recipe.siteNutrition?.kcal ? ` Siden selv oppgir ${Math.round(recipe.siteNutrition.kcal)} kcal per porsjon.` : ''}
        </p>
      )}
      <div>
        <h4 className="mb-1 text-sm font-semibold">
          Ingredienser for {servings} {servings === 1 ? 'porsjon' : 'porsjoner'}
          {leftoverDays?.length ? <span className="font-normal text-stone-500"> (inkl. rester til {leftoverDays.map((d) => DAY_NAMES[d].toLowerCase()).join(', ')})</span> : null}
        </h4>
        <ul className="space-y-1 text-sm">
          {recipe.ingredients.map((ing, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
              <span>
                {norsk ? norwegianIngredient(ing, factor, ingredients) : scaledLine(ing, factor)}
                {!ing.id && <span className="ml-1 text-xs text-stone-400">(ikke tolket)</span>}
              </span>
            </li>
          ))}
        </ul>
        {norsk && (
          <details className="mt-2 text-xs text-stone-500">
            <summary className="cursor-pointer">Vis original ingrediensliste (engelsk)</summary>
            <ul className="mt-1 space-y-0.5 pl-3">
              {recipe.ingredients.map((ing, i) => (
                <li key={i}>{scaledLine(ing, factor)}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {shared && shared.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-semibold">Deler ingredienser med</h4>
          <div className="flex flex-wrap gap-1.5">
            {shared.map((s) => (
              <span key={s.id} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-900 ring-1 ring-brand-100">
                {s.name}: {s.days.map((d) => DAY_NAMES[d].slice(0, 3).toLowerCase()).join(', ')}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="mb-1 text-sm font-semibold">Næringsinnhold</h4>
        <NutritionTable actual={recipe.perServing} target={target} />
        <p className="mt-1 text-xs text-stone-500">Beregnet fra ingrediensene med Matvaretabellen.</p>
      </div>

      <RecipePrice recipe={recipe} ingredients={ingredients} />

      <div>
        <h4 className="mb-1 text-sm font-semibold">Fremgangsmåte</h4>
        {recipe.instructions?.length ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {recipe.instructions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        ) : foreign ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <a href={translatedUrl(recipe.url)} target="_blank" rel="noreferrer" className="btn-secondary w-full sm:w-auto">
              <Icon name="external" className="h-4 w-4" />
              Fremgangsmåten på norsk (Google Oversetter)
            </a>
            <a href={recipe.url} target="_blank" rel="noreferrer" className="btn-ghost w-full text-sm sm:w-auto">
              Original på engelsk hos {recipe.sourceName}
            </a>
          </div>
        ) : (
          <a href={recipe.url} target="_blank" rel="noreferrer" className="btn-secondary w-full sm:w-auto">
            <Icon name="external" className="h-4 w-4" />
            Se fremgangsmåten hos {recipe.sourceName}
          </a>
        )}
      </div>

      <p className="text-xs text-stone-500">
        Kilde:{' '}
        <a className="underline" href={recipe.url} target="_blank" rel="noreferrer">
          {recipe.sourceName}
        </a>
      </p>
    </div>
  );
}
