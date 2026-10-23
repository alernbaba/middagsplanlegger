import { useMemo, useState } from 'react';
import type { RecipeData } from '../lib/data.ts';
import { buildShoppingList, DEPARTMENTS, formatAmount, formatBuy, formatLeftover, isAtHome, mealsFromPlan, shoppingListText, type ShoppingItem } from '../lib/shopping.ts';
import { weekNumber } from '../lib/storage.ts';
import { DAY_SHORT, type UserData } from '../lib/types.ts';
import { Empty, Icon } from './ui.tsx';

interface Props {
  data: UserData;
  update: (fn: (d: UserData) => UserData) => void;
  rd: RecipeData;
  toast: (m: string) => void;
}

export function ShoppingView({ data, update, rd, toast }: Props) {
  const plan = data.currentPlan;
  const [showHome, setShowHome] = useState(false);
  const items = useMemo(() => (plan ? buildShoppingList(mealsFromPlan(plan.days, rd.byId), rd.file.ingredients) : []), [plan, rd]);

  if (!plan || items.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Handleliste</h1>
        <Empty>Lag en ukeplan først, så dukker handlelisten opp her.</Empty>
      </div>
    );
  }

  const checked = data.checked[plan.id] ?? {};
  const toBuy = items.filter((i) => !isAtHome(i, data.atHome));
  const atHome = items.filter((i) => isAtHome(i, data.atHome));
  const leftovers = items.filter((i) => !isAtHome(i, data.atHome) && formatLeftover(i));
  const done = toBuy.filter((i) => checked[i.key]).length;
  const title = `Handleliste uke ${weekNumber(plan.weekStart)}`;

  const toggle = (key: string) =>
    update((d) => ({ ...d, checked: { ...d.checked, [plan.id]: { ...(d.checked[plan.id] ?? {}), [key]: !checked[key] } } }));
  const setHome = (item: ShoppingItem, v: boolean) => update((d) => ({ ...d, atHome: { ...d.atHome, [item.key]: v } }));

  const text = () => shoppingListText(items, data.atHome, checked, title);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      toast('Handlelisten er kopiert');
    } catch {
      toast('Kunne ikke kopiere – prøv Del i stedet');
    }
  };
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, text: text() });
      } catch {
        /* avbrutt av brukeren */
      }
    } else {
      copy();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Handleliste</h1>
          <p className="text-sm text-stone-500">
            Uke {weekNumber(plan.weekStart)} · {done} av {toBuy.length} varer krysset av
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <button className="btn-secondary flex-1 sm:flex-none" onClick={copy}>
            <Icon name="copy" className="h-4 w-4" /> Kopier
          </button>
          <button className="btn-primary flex-1 sm:flex-none" onClick={share}>
            <Icon name="share" className="h-4 w-4" /> Del
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          {DEPARTMENTS.map((dept) => {
            const its = toBuy.filter((i) => i.dept === dept.id);
            if (!its.length) return null;
            return (
              <section key={dept.id} className="card overflow-hidden">
                <h2 className="bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-700">{dept.name}</h2>
                <ul className="divide-y divide-stone-100">
                  {its.map((i) => (
                    <li key={i.key} className="flex items-center gap-3 px-4 py-2">
                      <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3">
                        <input type="checkbox" className="h-6 w-6 shrink-0 accent-brand-600" checked={!!checked[i.key]} onChange={() => toggle(i.key)} />
                        <span className={`min-w-0 ${checked[i.key] ? 'text-stone-400 line-through' : ''}`}>
                          <span className="block font-medium">{i.name}</span>
                          <span className="block text-xs text-stone-500">
                            {i.rawLines ? i.rawLines.join(', ') : `${formatBuy(i)}`}
                            {i.need && i.info && i.buy && Math.abs(i.buy.total - i.need) > 0.01 ? ` · trenger ${formatAmount(i.need, i.info)}` : ''}
                            {' · '}
                            {i.days.map((d) => DAY_SHORT[d]).join(', ')}
                          </span>
                        </span>
                      </label>
                      {!i.rawLines && (
                        <button className="btn-ghost shrink-0 px-2 text-xs text-stone-500" onClick={() => setHome(i, true)} title="Jeg har dette hjemme">
                          Har hjemme
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {done > 0 && (
            <button className="btn-ghost w-full text-stone-500" onClick={() => update((d) => ({ ...d, checked: { ...d.checked, [plan.id]: {} } }))}>
              Fjern alle avkrysninger
            </button>
          )}
        </div>

        <aside className="space-y-4">
          <section className="card p-4">
            <h2 className="mb-1 font-semibold">Til overs etter uken</h2>
            <p className="mb-2 text-xs text-stone-500">Det som blir igjen når varene kjøpes i vanlige pakningsstørrelser.</p>
            {leftovers.length === 0 ? (
              <p className="text-sm text-emerald-700">Nesten ingenting – bra!</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {leftovers.map((i) => (
                  <li key={i.key} className="flex justify-between gap-2">
                    <span>{i.name}</span>
                    <span className="tabular-nums text-stone-600">{formatLeftover(i)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-4">
            <button className="flex w-full items-center justify-between font-semibold" onClick={() => setShowHome(!showHome)} aria-expanded={showHome}>
              Basisvarer og har hjemme ({atHome.length})
              <Icon name="chevron" className={`h-4 w-4 transition ${showHome ? 'rotate-180' : ''}`} />
            </button>
            <p className="mt-1 text-xs text-stone-500">Skjules fra listen. Trykk «Trenger» hvis du må kjøpe varen.</p>
            {showHome && (
              <ul className="mt-2 divide-y divide-stone-100 text-sm">
                {atHome.map((i) => (
                  <li key={i.key} className="flex items-center justify-between gap-2 py-1.5">
                    <span>
                      {i.name} <span className="text-xs text-stone-500">{i.buy ? formatBuy(i) : ''}</span>
                    </span>
                    <button className="btn-ghost min-h-9 px-2 text-xs" onClick={() => setHome(i, false)}>
                      Trenger
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
