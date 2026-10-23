import { useMemo, useState } from 'react';
import type { Recipe } from '../../shared/types.ts';
import type { RecipeData } from '../lib/data.ts';
import { ensurePlan, generatePlan, makeOptimizer, rateRecipe, setDay, toggleHidden, upsertHistory } from '../lib/plan.ts';
import { buildShoppingList, formatLeftover, mealsFromPlan, sharedIngredients, type Meal } from '../lib/shopping.ts';
import { weekNumber } from '../lib/storage.ts';
import { deviationLevel, deviationPct, dinnerTarget, energyPercent, targetMacroPercent } from '../lib/targets.ts';
import { DAY_NAMES, type Day, type PlanDay, type UserData } from '../lib/types.ts';
import { RecipeDetails } from './RecipeDetails.tsx';
import { RecipePicker } from './RecipesView.tsx';
import { Badge, Empty, Icon, Modal, Stars } from './ui.tsx';

interface Props {
  data: UserData;
  update: (fn: (d: UserData) => UserData) => void;
  rd: RecipeData;
  toast: (m: string) => void;
}

export function PlanView({ data, update, rd, toast }: Props) {
  const [swapDay, setSwapDay] = useState<Day | null>(null);
  const [pickDay, setPickDay] = useState<Day | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = data.currentPlan;
  const meals = useMemo(() => (plan ? mealsFromPlan(plan.days, rd.byId) : []), [plan, rd]);

  const generate = () => {
    setBusy(true);
    // La knappen vise "Lager plan …" før beregningen starter.
    setTimeout(() => {
      update((d) => generatePlan(d, rd));
      setBusy(false);
    }, 20);
  };

  if (!plan || !plan.days.some((d) => d.recipeId || d.leftoverFrom)) {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
          <Icon name="calendar" className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-bold">Ukens middager</h1>
        <p className="text-stone-600">
          Appen velger {data.settings.days.length} middager fra {rd.file.recipes.length} oppskrifter, slik at de treffer kalori- og makromålene dine og deler ingredienser for minst mulig svinn.
        </p>
        <button className="btn-primary w-full sm:w-auto" onClick={generate} disabled={busy || !data.settings.days.length}>
          <Icon name="sparkles" />
          {busy ? 'Lager plan …' : 'Lag ukeplan'}
        </button>
        {!data.settings.days.length && <p className="text-sm text-rose-700">Velg minst én dag under Innstillinger.</p>}
      </div>
    );
  }

  const alternativesFor = (day: Day) => {
    const days = ensurePlan(data).days;
    return makeOptimizer(data, rd, days, plan.weekStart, plan.id).alternatives(days.findIndex((x) => x.day === day));
  };
  const lockedCount = plan.days.filter((d) => d.locked).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Uke {weekNumber(plan.weekStart)}</h1>
          <p className="text-sm text-stone-500">{lockedCount ? `${lockedCount} låst – resten byttes når du lager ny plan` : 'Lås middager du vil beholde før du lager ny plan'}</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <button className="btn-secondary flex-1 sm:flex-none" onClick={() => {
            update((d) => ({ ...d, history: upsertHistory(d.history, plan) }));
            toast('Uken er lagret i historikken');
          }}>
            <Icon name="save" className="h-4 w-4" /> Lagre uke
          </button>
          <button className="btn-primary flex-1 sm:flex-none" onClick={generate} disabled={busy}>
            <Icon name="sparkles" className="h-4 w-4" /> {busy ? 'Lager …' : 'Ny plan'}
          </button>
        </div>
      </div>

      <WeekSummary data={data} meals={meals} rd={rd} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plan.days.map((d) => (
          <DayCard
            key={d.day}
            pd={d}
            data={data}
            rd={rd}
            meals={meals}
            onLock={() => update((x) => setDay(x, d.day, { locked: !d.locked }))}
            onSwap={() => setSwapDay(d.day)}
            onPick={() => setPickDay(d.day)}
            onRemove={() => update((x) => setDay(x, d.day, { recipeId: null, locked: false }))}
            onFavorite={(id) =>
              update((x) => ({ ...x, favorites: x.favorites.includes(id) ? x.favorites.filter((f) => f !== id) : [...x.favorites, id] }))
            }
            onRate={(id, n) => update((x) => rateRecipe(x, id, n))}
            onHide={(r) => {
              // Bytt straks til beste forslag som ikke er den skjulte oppskriften.
              const next = alternativesFor(d.day).find((a) => a.recipe.id !== r.id)?.recipe;
              update((x) => setDay(toggleHidden(x, r.id), d.day, { recipeId: next?.id ?? null, locked: false }));
              toast(`«${r.name}» er skjult og foreslås ikke igjen. Du finner den under Oppskrifter → Skjulte.`);
            }}
          />
        ))}
      </div>

      {swapDay && (
        <SwapDialog
          day={swapDay}
          plan={plan.days}
          getAlternatives={() => alternativesFor(swapDay)}
          onPick={(r) => {
            update((x) => setDay(x, swapDay, { recipeId: r.id }));
            setSwapDay(null);
            toast(`${DAY_NAMES[swapDay]}: ${r.name}`);
          }}
          onClose={() => setSwapDay(null)}
          rd={rd}
          data={data}
        />
      )}
      {pickDay && (
        <Modal title={`Velg middag for ${DAY_NAMES[pickDay].toLowerCase()}`} onClose={() => setPickDay(null)} wide>
          <RecipePicker
            data={data}
            update={update}
            rd={rd}
            onPick={(r) => {
              update((x) => setDay(x, pickDay, { recipeId: r.id, locked: true }));
              setPickDay(null);
              toast(`${r.name} er lagt til og låst`);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function WeekSummary({ data, meals, rd }: { data: UserData; meals: Meal[]; rd: RecipeData }) {
  const s = data.settings;
  const stats = useMemo(() => {
    const plan = data.currentPlan!;
    let kcal = 0;
    let target = 0;
    let p = 0;
    let f = 0;
    let c = 0;
    let n = 0;
    for (const d of plan.days) {
      const meal = meals.find((m) => m.day === (d.leftoverFrom ?? d.day));
      if (!meal) continue;
      const ps = meal.recipe.perServing;
      kcal += ps.kcal;
      p += ps.protein;
      f += ps.fat;
      c += ps.carbs;
      target += dinnerTarget(s, d.day).kcal;
      n++;
    }
    const items = buildShoppingList(meals, rd.file.ingredients);
    const leftovers = items.filter((i) => !i.info?.basis && formatLeftover(i)).length;
    const shared = items.filter((i) => i.info && !i.info.basis && i.dept !== 'krydder' && i.days.length > 1).length;
    return n ? { kcal: kcal / n, target: target / n, macro: energyPercent({ kcal, protein: p, fat: f, carbs: c }), leftovers, shared, n } : null;
  }, [data.currentPlan, meals, s, rd]);
  if (!stats) return null;
  const goal = targetMacroPercent(s);
  const level = deviationLevel(stats.kcal, stats.target);
  const bars: { key: 'protein' | 'fat' | 'carbs'; label: string; color: string }[] = [
    { key: 'protein', label: 'Protein', color: 'bg-sky-500' },
    { key: 'fat', label: 'Fett', color: 'bg-amber-500' },
    { key: 'carbs', label: 'Karbo', color: 'bg-emerald-500' },
  ];
  return (
    <section className="card grid gap-4 p-4 sm:grid-cols-3">
      <div>
        <p className="text-xs uppercase tracking-wide text-stone-500">Snitt per middag</p>
        <p className="text-2xl font-bold tabular-nums">{Math.round(stats.kcal)} kcal</p>
        <p className="mt-1 flex items-center gap-2 text-sm text-stone-600">
          mål {Math.round(stats.target)} kcal
          <Badge level={level}>
            {deviationPct(stats.kcal, stats.target) > 0 ? '+' : ''}
            {deviationPct(stats.kcal, stats.target)} %
          </Badge>
        </p>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs uppercase tracking-wide text-stone-500">Makrofordeling (energi)</p>
        {bars.map((b) => {
          const a = stats.macro[b.key];
          const t = goal[b.key];
          const lv = Math.abs(a - t) <= 5 ? 'ok' : Math.abs(a - t) <= 10 ? 'warn' : 'bad';
          return (
            <div key={b.key} className="text-xs">
              <div className="flex justify-between">
                <span>{b.label}</span>
                <span className="tabular-nums">
                  {Math.round(a)} % <span className="text-stone-400">/ mål {Math.round(t)} %</span>{' '}
                  <span className={lv === 'ok' ? 'text-emerald-700' : lv === 'warn' ? 'text-amber-700' : 'text-rose-700'}>●</span>
                </span>
              </div>
              <div className="relative mt-0.5 h-2 rounded-full bg-stone-100">
                <div className={`h-2 rounded-full ${b.color}`} style={{ width: `${Math.min(100, a)}%` }} />
                <div className="absolute top-[-2px] h-3 w-0.5 bg-stone-800" style={{ left: `${Math.min(100, t)}%` }} title="Mål" />
              </div>
            </div>
          );
        })}
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-stone-500">Ingredienser</p>
        <p className="text-sm">
          <span className="text-2xl font-bold">{stats.shared}</span> varer brukes flere dager
        </p>
        <p className="text-sm text-stone-600">{stats.leftovers} varer får rester (se handlelisten)</p>
      </div>
    </section>
  );
}

interface DayCardProps {
  pd: PlanDay;
  data: UserData;
  rd: RecipeData;
  meals: Meal[];
  onLock: () => void;
  onSwap: () => void;
  onPick: () => void;
  onRemove: () => void;
  onFavorite: (id: string) => void;
  onRate: (id: string, stars: number) => void;
  onHide: (r: Recipe) => void;
}

function DayCard({ pd, data, rd, meals, onLock, onSwap, onPick, onRemove, onFavorite, onRate, onHide }: DayCardProps) {
  const [open, setOpen] = useState(false);
  const target = dinnerTarget(data.settings, pd.day);
  const meal = meals.find((m) => m.day === pd.day);
  const source = pd.leftoverFrom ? meals.find((m) => m.day === pd.leftoverFrom) : undefined;

  if (pd.leftoverFrom) {
    return (
      <article className="card flex flex-col justify-center gap-1 border-dashed p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{DAY_NAMES[pd.day]}</h3>
        <p className="font-medium">Rester fra {DAY_NAMES[pd.leftoverFrom].toLowerCase()}</p>
        <p className="text-sm text-stone-600">{source ? source.recipe.name : 'Ingen middag valgt den dagen ennå'}</p>
        <p className="text-xs text-stone-500">
          {pd.servings} porsjoner lages ekstra på {DAY_NAMES[pd.leftoverFrom].toLowerCase()}
        </p>
      </article>
    );
  }

  const recipe = meal?.recipe ?? (pd.recipeId ? rd.byId.get(pd.recipeId) : undefined);
  const header = (
    <div className="flex items-center justify-between gap-2 px-4 pt-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
        {DAY_NAMES[pd.day]} · {meal?.cookServings ?? pd.servings} porsj.
      </h3>
      <div className="flex">
        <button className={`btn-ghost px-2.5 ${pd.locked ? 'text-brand-700' : 'text-stone-400'}`} onClick={onLock} disabled={!pd.recipeId} aria-label={pd.locked ? 'Lås opp' : 'Lås'} title={pd.locked ? 'Låst – beholdes ved ny plan' : 'Lås middagen'}>
          <Icon name={pd.locked ? 'lock' : 'unlock'} />
        </button>
        <button className="btn-ghost px-2.5" onClick={onSwap} aria-label="Bytt middag" title="Bytt middag">
          <Icon name="swap" />
        </button>
        <button className="btn-ghost px-2.5" onClick={onPick} aria-label="Velg oppskrift selv" title="Velg oppskrift selv">
          <Icon name="search" />
        </button>
      </div>
    </div>
  );

  if (!recipe) {
    return (
      <article className="card">
        {header}
        <div className="p-4">
          <Empty>
            {pd.recipeId ? 'Oppskriften finnes ikke lenger.' : 'Ingen middag valgt.'}{' '}
            <button className="underline" onClick={onSwap}>
              Få forslag
            </button>
          </Empty>
        </div>
      </article>
    );
  }

  const kcalLevel = deviationLevel(recipe.perServing.kcal, target.kcal);
  const fav = data.favorites.includes(recipe.id);
  const shared = meal ? sharedIngredients(meal, meals, rd.file.ingredients) : [];

  return (
    <article className={`card overflow-hidden ${pd.locked ? 'ring-2 ring-brand-200' : ''}`}>
      {header}
      <div className="flex gap-3 p-4">
        {recipe.image ? (
          <img src={recipe.image} alt="" loading="lazy" className="h-24 w-24 shrink-0 rounded-xl bg-stone-100 object-cover sm:h-28 sm:w-28" />
        ) : (
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 sm:h-28 sm:w-28">
            <Icon name="leaf" className="h-8 w-8" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold leading-snug">{recipe.name}</h4>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
            {recipe.totalTime ? (
              <span className="inline-flex items-center gap-1">
                <Icon name="clock" className="h-3.5 w-3.5" /> {recipe.totalTime} min
              </span>
            ) : null}
            <span>{recipe.sourceName}</span>
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <Badge level={kcalLevel}>{recipe.perServing.kcal} kcal</Badge>
            <span className="text-stone-500">
              P {Math.round(recipe.perServing.protein)} · F {Math.round(recipe.perServing.fat)} · K {Math.round(recipe.perServing.carbs)} g
            </span>
          </p>
          <div className="mt-1">
            <Stars value={data.ratings[recipe.id]} onRate={(n) => onRate(recipe.id, n)} size="h-4 w-4" />
          </div>
          {shared.length > 0 && (
            <p className="mt-1 truncate text-xs text-brand-700" title={shared.map((s) => s.name).join(', ')}>
              Deler {shared.length} {shared.length === 1 ? 'vare' : 'varer'}: {shared.map((s) => s.name.toLowerCase()).join(', ')}
            </p>
          )}
        </div>
      </div>
      <div className="flex border-t border-stone-100">
        <button className="btn-ghost flex-1 rounded-none" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Skjul oppskrift' : 'Vis oppskrift'}
          <Icon name="chevron" className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} />
        </button>
        <button className={`btn-ghost rounded-none px-4 ${fav ? 'text-rose-600' : 'text-stone-400'}`} onClick={() => onFavorite(recipe.id)} aria-label={fav ? 'Fjern favoritt' : 'Legg til favoritt'}>
          <Icon name="heart" filled={fav} />
        </button>
        <button className="btn-ghost rounded-none px-4 text-stone-400" onClick={() => onHide(recipe)} aria-label="Skjul oppskriften – liker den ikke" title="Liker ikke – skjul og bytt">
          <Icon name="eyeOff" />
        </button>
        <button className="btn-ghost rounded-none px-4 text-stone-400" onClick={onRemove} aria-label="Fjern middag" title="Fjern middagen fra dagen">
          <Icon name="trash" />
        </button>
      </div>
      {open && (
        <div className="border-t border-stone-100 p-4">
          <RecipeDetails recipe={recipe} servings={meal?.cookServings ?? pd.servings} target={target} ingredients={rd.file.ingredients} shared={shared} leftoverDays={meal?.leftoverDays} />
        </div>
      )}
    </article>
  );
}

interface SwapProps {
  day: Day;
  plan: PlanDay[];
  getAlternatives: () => { recipe: Recipe; score: number }[];
  onPick: (r: Recipe) => void;
  onClose: () => void;
  rd: RecipeData;
  data: UserData;
}

function SwapDialog({ day, plan, getAlternatives, onPick, onClose, rd, data }: SwapProps) {
  // Beregnes én gang når dialogen åpnes.
  const [alts] = useState(getAlternatives);
  const target = dinnerTarget(data.settings, day);
  const otherMeals = mealsFromPlan(plan.filter((p) => p.day !== day), rd.byId);
  return (
    <Modal title={`Bytt middag for ${DAY_NAMES[day].toLowerCase()}`} onClose={onClose}>
      <p className="mb-3 text-sm text-stone-600">Forslagene passer best med målene dine og ingrediensene du allerede kjøper denne uken.</p>
      {alts.length === 0 && <Empty>Fant ingen andre oppskrifter som passer innstillingene.</Empty>}
      <ul className="space-y-2">
        {alts.map(({ recipe }) => {
          const ids = new Set(recipe.ingredients.map((i) => i.id));
          const sharedNames = [...new Set(otherMeals.flatMap((m) => m.recipe.ingredients.filter((i) => i.id && ids.has(i.id) && !rd.file.ingredients[i.id]?.basis && rd.file.ingredients[i.id]?.dept !== 'krydder').map((i) => rd.file.ingredients[i.id!]?.name)))];
          return (
            <li key={recipe.id}>
              <button className="card flex w-full gap-3 p-3 text-left hover:border-brand-500" onClick={() => onPick(recipe)}>
                {recipe.image ? <img src={recipe.image} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-lg object-cover" /> : <div className="h-16 w-16 shrink-0 rounded-lg bg-brand-50" />}
                <div className="min-w-0">
                  <p className="font-medium leading-snug">{recipe.name}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                    <Badge level={deviationLevel(recipe.perServing.kcal, target.kcal)}>{recipe.perServing.kcal} kcal</Badge>
                    {recipe.totalTime ? <span>{recipe.totalTime} min</span> : null}
                    <span>{recipe.sourceName}</span>
                    {data.favorites.includes(recipe.id) && <span className="text-rose-600">♥ favoritt</span>}
                    <Stars value={data.ratings[recipe.id]} />
                  </p>
                  {sharedNames.length > 0 && <p className="mt-1 text-xs text-brand-700">Deler: {sharedNames.slice(0, 5).join(', ').toLowerCase()}</p>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
