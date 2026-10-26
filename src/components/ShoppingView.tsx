import { useMemo, useState } from 'react';
import type { RecipeData } from '../lib/data.ts';
import type { PriceStore } from '../../shared/types.ts';
import {
  buildShoppingList,
  DEPARTMENTS,
  formatAmount,
  formatBuy,
  formatKr,
  formatLeftover,
  isAtHome,
  itemCost,
  mealsFromPlan,
  PRICE_STORE_NAMES,
  PRICE_STORES,
  priceSummary,
  shoppingListText,
  type ShoppingItem,
} from '../lib/shopping.ts';
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
  const meals = useMemo(() => (plan ? mealsFromPlan(plan.days, rd.byId) : []), [plan, rd]);
  const items = useMemo(() => buildShoppingList(meals, rd.file.ingredients), [meals, rd]);
  const store = data.settings.priceStore;
  const hasPrices = items.some((i) => i.info?.prices);

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

  const setStore = (priceStore: PriceStore) => update((d) => ({ ...d, settings: { ...d.settings, priceStore } }));
  const summaries = Object.fromEntries(PRICE_STORES.map((s) => [s, priceSummary(toBuy, s)])) as Record<PriceStore, ReturnType<typeof priceSummary>>;
  const sum = summaries[store];
  const portions = meals.reduce((n, m) => n + m.cookServings, 0);

  const text = () => shoppingListText(items, data.atHome, checked, title, hasPrices ? store : undefined);
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
            {hasPrices && sum.priced > 0 && <> · ca. {formatKr(sum.total)} hos {PRICE_STORE_NAMES[store]}</>}
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
                <h2 className="flex justify-between gap-2 bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-700">
                  {dept.name}
                  {hasPrices && priceSummary(its, store).priced > 0 && (
                    <span className="font-normal tabular-nums text-stone-500">ca. {formatKr(priceSummary(its, store).total)}</span>
                  )}
                </h2>
                <ul className="divide-y divide-stone-100">
                  {its.map((i) => {
                    const cost = hasPrices ? itemCost(i, store) : undefined;
                    return (
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
                      {cost && (
                        <span
                          className={`shrink-0 text-right text-sm tabular-nums ${checked[i.key] ? 'text-stone-400' : 'text-stone-700'}`}
                          title={`${cost.product} hos ${PRICE_STORE_NAMES[cost.store]}`}
                        >
                          {formatKr(cost.kr)}
                          {cost.store !== store && <span className="block text-[10px] text-stone-400">{PRICE_STORE_NAMES[cost.store]}</span>}
                        </span>
                      )}
                      {!i.rawLines && (
                        <button className="btn-ghost shrink-0 px-2 text-xs text-stone-500" onClick={() => setHome(i, true)} title="Jeg har dette hjemme">
                          Har hjemme
                        </button>
                      )}
                    </li>
                    );
                  })}
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
          {hasPrices && (
            <section className="card p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="font-semibold">Pris</h2>
                <div className="flex rounded-lg bg-stone-100 p-0.5 text-xs" role="group" aria-label="Butikk">
                  {PRICE_STORES.map((s) => (
                    <button
                      key={s}
                      className={`min-h-8 rounded-md px-3 font-medium ${s === store ? 'bg-white shadow-sm' : 'text-stone-500'}`}
                      aria-pressed={s === store}
                      onClick={() => setStore(s)}
                    >
                      {PRICE_STORE_NAMES[s]}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-2xl font-bold tabular-nums">ca. {formatKr(sum.total)}</p>
              <p className="text-sm text-stone-600">
                for {sum.priced} varer hos {PRICE_STORE_NAMES[store]}
                {portions > 0 && <> · ca. {formatKr(sum.used / portions)} per porsjon for det som brukes</>}
              </p>
              <ul className="mt-2 space-y-0.5 text-xs text-stone-500">
                {PRICE_STORES.filter((s) => s !== store).map((s) => (
                  <li key={s}>
                    {PRICE_STORE_NAMES[s]}: ca. {formatKr(summaries[s].total)}
                    {summaries[s].total !== sum.total && ` (${summaries[s].total > sum.total ? '+' : '−'}${formatKr(Math.abs(summaries[s].total - sum.total))})`}
                  </li>
                ))}
                {sum.fromOther > 0 && <li>{sum.fromOther} varer finnes ikke hos {PRICE_STORE_NAMES[store]} og har pris fra den andre butikken.</li>}
                {sum.missing > 0 && <li>{sum.missing} varer mangler pris og er ikke med i summen.</li>}
                <li>
                  Typiske priser fra nettbutikkene{rd.file.pricesDate ? `, hentet ${new Date(rd.file.pricesDate).toLocaleDateString('nb-NO')}` : ''}.
                </li>
              </ul>
            </section>
          )}

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
