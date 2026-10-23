import { useDeferredValue, useMemo, useState } from 'react';
import type { Category, Recipe } from '../../shared/types.ts';
import type { RecipeData } from '../lib/data.ts';
import { ensurePlan, setDay } from '../lib/plan.ts';
import { deviationLevel, dinnerTarget, recipeAllowed } from '../lib/targets.ts';
import { DAY_NAMES, type Day, type UserData } from '../lib/types.ts';
import { RecipeDetails } from './RecipeDetails.tsx';
import { Badge, Empty, Icon, Modal } from './ui.tsx';

export const CATEGORY_NAMES: Record<Category, string> = {
  vegetar: 'Vegetar',
  vegansk: 'Vegansk',
  pescetar: 'Fisk og sjømat',
  lavkarbo: 'Lavkarbo',
  keto: 'Keto',
  hoyprotein: 'Høyprotein',
  sunt: 'Sunt',
  middelhav: 'Middelhav',
};

interface Props {
  data: UserData;
  update: (fn: (d: UserData) => UserData) => void;
  rd: RecipeData;
  toast?: (m: string) => void;
  onPick?: (r: Recipe) => void;
}

function normalize(s: string) {
  return s.toLowerCase().normalize('NFC');
}

/** Søk og filtrering av oppskrifter. Med `onPick` brukes den som velger for én dag. */
export function RecipePicker({ data, update, rd, onPick, toast }: Props) {
  const [query, setQuery] = useState('');
  const [onlyFav, setOnlyFav] = useState(false);
  const [onlyAllowed, setOnlyAllowed] = useState(true);
  const [category, setCategory] = useState<Category | ''>('');
  const [sort, setSort] = useState<'navn' | 'kcal' | 'tid' | 'protein'>('navn');
  const [limit, setLimit] = useState(40);
  const [detail, setDetail] = useState<Recipe | null>(null);
  const q = useDeferredValue(query);

  const names = useMemo(() => Object.fromEntries(Object.entries(rd.file.ingredients).map(([id, i]) => [id, i.name])), [rd]);
  const results = useMemo(() => {
    const terms = normalize(q).split(/\s+/).filter(Boolean);
    const fav = new Set(data.favorites);
    const list = rd.file.recipes.filter((r) => {
      if (onlyFav && !fav.has(r.id)) return false;
      if (category && !r.categories.includes(category)) return false;
      if (onlyAllowed && !recipeAllowed(r, data.settings, names)) return false;
      if (terms.length) {
        const hay = normalize(`${r.name} ${r.sourceName} ${r.ingredients.map((i) => (i.id ? names[i.id] : i.raw)).join(' ')}`);
        if (!terms.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
    const cmp: Record<typeof sort, (a: Recipe, b: Recipe) => number> = {
      navn: (a, b) => a.name.localeCompare(b.name, 'nb'),
      kcal: (a, b) => a.perServing.kcal - b.perServing.kcal,
      tid: (a, b) => (a.totalTime ?? 999) - (b.totalTime ?? 999),
      protein: (a, b) => b.perServing.protein - a.perServing.protein,
    };
    return list.sort(cmp[sort]);
  }, [q, onlyFav, onlyAllowed, category, sort, rd, data.favorites, data.settings, names]);

  const target = dinnerTarget(data.settings, data.settings.days[0] ?? 'man');
  const toggleFav = (id: string) =>
    update((x) => ({ ...x, favorites: x.favorites.includes(id) ? x.favorites.filter((f) => f !== id) : [...x.favorites, id] }));

  const addToDay = (r: Recipe, day: Day) => {
    update((x) => {
      const withPlan = { ...x, currentPlan: ensurePlan(x) };
      return setDay(withPlan, day, { recipeId: r.id, locked: true, leftoverFrom: undefined });
    });
    toast?.(`${r.name} lagt til ${DAY_NAMES[day].toLowerCase()} og låst`);
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-stone-400" />
        <input className="input pl-10" type="search" placeholder="Søk etter rett eller ingrediens, f.eks. «laks brokkoli»" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(40); }} />
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <FilterChip active={onlyAllowed} onClick={() => setOnlyAllowed(!onlyAllowed)}>Passer innstillingene</FilterChip>
        <FilterChip active={onlyFav} onClick={() => setOnlyFav(!onlyFav)}>♥ Favoritter</FilterChip>
        <select className="min-h-9 rounded-full border border-stone-300 bg-white px-3 text-sm" value={category} onChange={(e) => setCategory(e.target.value as Category | '')} aria-label="Kategori">
          <option value="">Alle kategorier</option>
          {Object.entries(CATEGORY_NAMES).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select className="min-h-9 rounded-full border border-stone-300 bg-white px-3 text-sm" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sortering">
          <option value="navn">Sorter: navn</option>
          <option value="kcal">Sorter: kalorier</option>
          <option value="protein">Sorter: mest protein</option>
          <option value="tid">Sorter: tid</option>
        </select>
      </div>
      <p className="text-xs text-stone-500">{results.length} oppskrifter</p>
      {results.length === 0 && <Empty>Ingen oppskrifter passer søket.</Empty>}
      <ul className="grid gap-2 sm:grid-cols-2">
        {results.slice(0, limit).map((r) => {
          const fav = data.favorites.includes(r.id);
          return (
            <li key={r.id} className="card flex gap-3 p-3">
              <button className="flex min-w-0 flex-1 gap-3 text-left" onClick={() => setDetail(r)}>
                {r.image ? <img src={r.image} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-lg bg-stone-100 object-cover" /> : <div className="h-16 w-16 shrink-0 rounded-lg bg-brand-50" />}
                <span className="min-w-0">
                  <span className="block font-medium leading-snug">{r.name}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                    <Badge level={deviationLevel(r.perServing.kcal, target.kcal)}>{r.perServing.kcal} kcal</Badge>
                    {r.totalTime ? <span>{r.totalTime} min</span> : null}
                    <span>{r.sourceName}</span>
                  </span>
                </span>
              </button>
              <div className="flex shrink-0 flex-col items-end justify-between">
                <button className={`btn-ghost px-2 ${fav ? 'text-rose-600' : 'text-stone-400'}`} onClick={() => toggleFav(r.id)} aria-label={fav ? 'Fjern favoritt' : 'Legg til favoritt'}>
                  <Icon name="heart" filled={fav} />
                </button>
                {onPick ? (
                  <button className="btn-primary min-h-9 px-3 py-1" onClick={() => onPick(r)}>Velg</button>
                ) : (
                  <DayMenu days={data.settings.days} onSelect={(d) => addToDay(r, d)} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {results.length > limit && (
        <button className="btn-secondary w-full" onClick={() => setLimit(limit + 40)}>Vis flere</button>
      )}
      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)} wide>
          {detail.image && <img src={detail.image} alt="" className="mb-4 aspect-video w-full rounded-xl object-cover" />}
          <RecipeDetails recipe={detail} servings={detail.servings} target={target} ingredients={rd.file.ingredients} />
          {onPick && (
            <button className="btn-primary mt-4 w-full" onClick={() => onPick(detail)}>Velg denne</button>
          )}
        </Modal>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active} className={`min-h-9 rounded-full border px-3 ${active ? 'border-brand-600 bg-brand-600 text-white' : 'border-stone-300 bg-white text-stone-700'}`}>
      {children}
    </button>
  );
}

function DayMenu({ days, onSelect }: { days: Day[]; onSelect: (d: Day) => void }) {
  return (
    <select
      className="min-h-9 max-w-28 rounded-lg border border-stone-300 bg-white px-2 text-xs"
      value=""
      onChange={(e) => e.target.value && onSelect(e.target.value as Day)}
      aria-label="Legg til på dag"
    >
      <option value="">+ Legg til</option>
      {days.map((d) => (
        <option key={d} value={d}>{DAY_NAMES[d]}</option>
      ))}
    </select>
  );
}

export function RecipesView(props: Props) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Oppskrifter</h1>
        <p className="text-sm text-stone-500">
          {props.rd.file.recipes.length} oppskrifter, oppdatert {new Date(props.rd.file.generatedAt).toLocaleDateString('nb-NO')}.
        </p>
      </div>
      <RecipePicker {...props} />
    </div>
  );
}
