import type { RecipeData } from '../lib/data.ts';
import { rateRecipe, upsertHistory } from '../lib/plan.ts';
import { weekNumber } from '../lib/storage.ts';
import { DAY_SHORT, type UserData, type WeekPlan } from '../lib/types.ts';
import { Empty, Icon, Stars } from './ui.tsx';

interface Props {
  data: UserData;
  update: (fn: (d: UserData) => UserData) => void;
  rd: RecipeData;
  toast: (m: string) => void;
  goToPlan: () => void;
}

export function HistoryView({ data, update, rd, toast, goToPlan }: Props) {
  const open = (p: WeekPlan) => {
    update((d) => ({
      ...d,
      // Den åpne planen legges i historikken så den ikke går tapt.
      history: d.currentPlan ? upsertHistory(d.history, d.currentPlan) : d.history,
      currentPlan: { ...p, days: p.days.map((x) => ({ ...x })) },
    }));
    toast(`Uke ${weekNumber(p.weekStart)} er åpnet`);
    goToPlan();
  };
  const remove = (p: WeekPlan) => {
    if (!confirm(`Slette uke ${weekNumber(p.weekStart)} fra historikken?`)) return;
    update((d) => ({ ...d, history: d.history.filter((h) => h.id !== p.id) }));
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Tidligere uker</h1>
        <p className="text-sm text-stone-500">
          Planer lagres når du trykker «Lagre uke», og automatisk når en ny uke starter.
          {data.settings.avoidRecent && ' Oppskrifter fra de to siste ukene foreslås ikke på nytt.'} Gi stjerner til rettene dere har spist, så foreslås favorittene oftere.
        </p>
      </div>
      {data.history.length === 0 && <Empty>Ingen lagrede uker ennå.</Empty>}
      <ul className="grid gap-3 md:grid-cols-2">
        {data.history.map((p) => (
          <li key={p.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">
                  Uke {weekNumber(p.weekStart)}{' '}
                  {p.id === data.currentPlan?.id && <span className="ml-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-800">åpen nå</span>}
                </h2>
                <p className="text-xs text-stone-500">fra {new Date(p.weekStart + 'T12:00:00').toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              </div>
              <button className="btn-ghost px-2 text-stone-400" onClick={() => remove(p)} aria-label="Slett">
                <Icon name="trash" className="h-4 w-4" />
              </button>
            </div>
            <ul className="mt-2 space-y-0.5 text-sm">
              {p.days.map((d) => (
                <li key={d.day} className="flex items-center gap-2">
                  <span className="w-9 shrink-0 text-stone-500">{DAY_SHORT[d.day]}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {d.leftoverFrom ? `Rester fra ${DAY_SHORT[d.leftoverFrom].toLowerCase()}` : d.recipeId ? rd.byId.get(d.recipeId)?.name ?? 'Oppskrift som er fjernet' : '–'}
                  </span>
                  {!d.leftoverFrom && d.recipeId && rd.byId.has(d.recipeId) && (
                    <Stars value={data.ratings[d.recipeId]} onRate={(n) => update((x) => rateRecipe(x, d.recipeId!, n))} size="h-3.5 w-3.5" />
                  )}
                </li>
              ))}
            </ul>
            <button className="btn-secondary mt-3 w-full" onClick={() => open(p)}>
              Åpne denne uken
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
