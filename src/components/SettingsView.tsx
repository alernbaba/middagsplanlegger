import { useRef, type ReactNode } from 'react';
import type { Allergen } from '../../shared/types.ts';
import { planSkeleton, validLeftovers } from '../lib/plan.ts';
import { defaultData, exportData, importData } from '../lib/storage.ts';
import { DIET_PRESETS, dinnerKcal, targetMacroPercent } from '../lib/targets.ts';
import { DAY_NAMES, DAY_SHORT, DAYS, type Day, type DietCategory, type Macros, type Settings, type UserData } from '../lib/types.ts';
import { Icon, Toggle } from './ui.tsx';

const ALLERGENS: { id: Allergen; name: string }[] = [
  { id: 'gluten', name: 'Gluten' },
  { id: 'laktose', name: 'Laktose/melk' },
  { id: 'notter', name: 'Nøtter' },
  { id: 'peanotter', name: 'Peanøtter' },
  { id: 'skalldyr', name: 'Skalldyr' },
  { id: 'fisk', name: 'Fisk' },
  { id: 'egg', name: 'Egg' },
  { id: 'soya', name: 'Soya' },
  { id: 'selleri', name: 'Selleri' },
  { id: 'sennep', name: 'Sennep' },
  { id: 'sesam', name: 'Sesam' },
];

const MACRO_LABELS: Record<keyof Macros, string> = { protein: 'Protein', fat: 'Fett', carbs: 'Karbohydrater' };

/** Endrer én makro og fordeler resten på de to andre, så summen alltid er 100 %. */
export function adjustMacros(m: Macros, key: keyof Macros, value: number): Macros {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const others = (Object.keys(m) as (keyof Macros)[]).filter((k) => k !== key);
  const restOld = others.reduce((s, k) => s + m[k], 0);
  const rest = 100 - v;
  const first = restOld > 0 ? Math.round((m[others[0]] * rest) / restOld) : Math.round(rest / 2);
  return { ...m, [key]: v, [others[0]]: first, [others[1]]: rest - first } as Macros;
}

interface Props {
  data: UserData;
  update: (fn: (d: UserData) => UserData) => void;
  toast: (m: string) => void;
}

function Section({ title, children, description }: { title: string; children: ReactNode; description?: string }) {
  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-stone-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex w-full rounded-xl bg-stone-100 p-1 sm:w-auto">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} className={`min-h-10 flex-1 rounded-lg px-4 text-sm font-medium ${value === o.value ? 'bg-white shadow' : 'text-stone-600'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsView({ data, update, toast }: Props) {
  const s = data.settings;
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Settings>) =>
    update((d) => {
      const settings = { ...d.settings, ...patch };
      return { ...d, settings, currentPlan: d.currentPlan ? { ...d.currentPlan, days: planSkeleton(settings, d.currentPlan.days) } : null };
    });
  const toggleDay = (day: Day) => set({ days: s.days.includes(day) ? s.days.filter((d) => d !== day) : DAYS.filter((d) => d === day || s.days.includes(d)) });
  const pct = targetMacroPercent(s);
  const gramKcal = s.macroGrams.protein * 4 + s.macroGrams.fat * 9 + s.macroGrams.carbs * 4;
  const invalidLeftovers = s.leftovers.length - validLeftovers(s).length;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">Innstillinger</h1>

      <Section title="Kosthold">
        <Segmented value={s.dietMode} onChange={(v) => set({ dietMode: v })} options={[{ value: 'kategori', label: 'Kategori' }, { value: 'makro', label: 'Egne makroer' }]} />
        {s.dietMode === 'kategori' ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(DIET_PRESETS) as DietCategory[]).map((k) => {
              const p = DIET_PRESETS[k];
              return (
                <button key={k} onClick={() => set({ dietCategory: k })} className={`rounded-xl border p-3 text-left ${s.dietCategory === k ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-stone-200 bg-white'}`}>
                  <span className="block font-medium">{p.label}</span>
                  <span className="block text-xs text-stone-500">{p.description}</span>
                  <span className="mt-1 block text-xs text-stone-600">
                    P {p.macros.protein} % · F {p.macros.fat} % · K {p.macros.carbs} %
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            <Segmented value={s.macroUnit} onChange={(v) => set({ macroUnit: v })} options={[{ value: 'prosent', label: 'Prosent' }, { value: 'gram', label: 'Gram per dag' }]} />
            {s.macroUnit === 'prosent' ? (
              (Object.keys(MACRO_LABELS) as (keyof Macros)[]).map((k) => (
                <label key={k} className="block">
                  <span className="flex justify-between text-sm">
                    <span>{MACRO_LABELS[k]}</span>
                    <span className="font-semibold tabular-nums">{s.macroPercent[k]} %</span>
                  </span>
                  <input type="range" min={0} max={100} value={s.macroPercent[k]} onChange={(e) => set({ macroPercent: adjustMacros(s.macroPercent, k, Number(e.target.value)) })} className="h-8 w-full accent-brand-600" />
                </label>
              ))
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(MACRO_LABELS) as (keyof Macros)[]).map((k) => (
                    <label key={k}>
                      <span className="label">{MACRO_LABELS[k]} (g)</span>
                      <input className="input" type="number" inputMode="numeric" min={0} value={s.macroGrams[k]} onChange={(e) => set({ macroGrams: { ...s.macroGrams, [k]: Math.max(0, Number(e.target.value)) } })} />
                    </label>
                  ))}
                </div>
                <p className="text-sm text-stone-600">
                  Tilsvarer {Math.round(gramKcal)} kcal per dag: protein {Math.round(pct.protein)} %, fett {Math.round(pct.fat)} %, karbohydrater {Math.round(pct.carbs)} %. Fordelingen brukes som mål, og kaloriene styres av kalorimålet under.
                </p>
              </>
            )}
          </div>
        )}
      </Section>

      <Section title="Kalorier">
        <Segmented value={s.calorieMode} onChange={(v) => set({ calorieMode: v })} options={[{ value: 'lik', label: 'Likt alle dager' }, { value: 'perDag', label: 'Per ukedag' }]} />
        {s.calorieMode === 'lik' ? (
          <label className="block max-w-xs">
            <span className="label">Kalorier per dag</span>
            <input className="input" type="number" inputMode="numeric" min={800} step={50} value={s.dailyKcal} onChange={(e) => set({ dailyKcal: Number(e.target.value) })} />
          </label>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {DAYS.map((d) => (
              <label key={d}>
                <span className="label">{DAY_NAMES[d]}</span>
                <input className="input" type="number" inputMode="numeric" min={800} step={50} value={s.dailyKcalPerDay[d]} onChange={(e) => set({ dailyKcalPerDay: { ...s.dailyKcalPerDay, [d]: Number(e.target.value) } })} />
              </label>
            ))}
          </div>
        )}
        <label className="block">
          <span className="flex justify-between text-sm">
            <span>Middagens andel av dagen</span>
            <span className="font-semibold tabular-nums">{Math.round(s.dinnerShare * 100)} %</span>
          </span>
          <input type="range" min={15} max={60} value={Math.round(s.dinnerShare * 100)} onChange={(e) => set({ dinnerShare: Number(e.target.value) / 100 })} className="h-8 w-full accent-brand-600" />
        </label>
        <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-900">
          Mål per middagsporsjon:{' '}
          {s.calorieMode === 'lik'
            ? `${dinnerKcal(s, 'man')} kcal`
            : s.days.map((d) => `${DAY_SHORT[d]} ${dinnerKcal(s, d)}`).join(' · ') + ' kcal'}
        </p>
      </Section>

      <Section title="Dager og porsjoner" description="Velg hvilke dager som skal planlegges, og hvor mange som spiser.">
        <ul className="divide-y divide-stone-100">
          {DAYS.map((d) => {
            const on = s.days.includes(d);
            return (
              <li key={d} className="flex items-center justify-between gap-3 py-1.5">
                <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3">
                  <input type="checkbox" className="h-6 w-6 accent-brand-600" checked={on} onChange={() => toggleDay(d)} />
                  <span className={on ? 'font-medium' : 'text-stone-400'}>{DAY_NAMES[d]}</span>
                </label>
                <div className={`flex items-center gap-1 ${on ? '' : 'opacity-40'}`}>
                  <button className="btn-secondary h-10 w-10 px-0" disabled={!on || s.servings[d] <= 1} onClick={() => set({ servings: { ...s.servings, [d]: s.servings[d] - 1 } })} aria-label={`Færre porsjoner ${DAY_NAMES[d]}`}>−</button>
                  <span className="w-16 text-center text-sm tabular-nums">{s.servings[d]} porsj.</span>
                  <button className="btn-secondary h-10 w-10 px-0" disabled={!on || s.servings[d] >= 12} onClick={() => set({ servings: { ...s.servings, [d]: s.servings[d] + 1 } })} aria-label={`Flere porsjoner ${DAY_NAMES[d]}`}>+</button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="space-y-2 border-t border-stone-100 pt-3">
          <h3 className="text-sm font-semibold">Lag ekstra og spis rester</h3>
          <p className="text-xs text-stone-500">Middagen lages med ekstra porsjoner, og restene spises en senere dag.</p>
          {s.leftovers.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span>Lag ekstra</span>
              <select className="input w-auto" value={l.from} onChange={(e) => set({ leftovers: s.leftovers.map((x, j) => (j === i ? { ...x, from: e.target.value as Day } : x)) })}>
                {DAYS.map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
              </select>
              <span>spis rester</span>
              <select className="input w-auto" value={l.to} onChange={(e) => set({ leftovers: s.leftovers.map((x, j) => (j === i ? { ...x, to: e.target.value as Day } : x)) })}>
                {DAYS.map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
              </select>
              <button className="btn-ghost px-2 text-stone-400" onClick={() => set({ leftovers: s.leftovers.filter((_, j) => j !== i) })} aria-label="Fjern">
                <Icon name="trash" className="h-4 w-4" />
              </button>
            </div>
          ))}
          {invalidLeftovers > 0 && <p className="text-xs text-amber-700">Noen koblinger brukes ikke: begge dagene må være valgt, og restene må spises en senere dag.</p>}
          <button className="btn-secondary" onClick={() => set({ leftovers: [...s.leftovers, { from: s.days[0] ?? 'man', to: s.days[1] ?? 'tir' }] })}>
            <Icon name="plus" className="h-4 w-4" /> Legg til rester
          </button>
        </div>
      </Section>

      <Section title="Begrensninger">
        <div>
          <span className="label">Allergier og intoleranser</span>
          <div className="flex flex-wrap gap-2">
            {ALLERGENS.map((a) => {
              const on = s.allergies.includes(a.id);
              return (
                <button key={a.id} aria-pressed={on} onClick={() => set({ allergies: on ? s.allergies.filter((x) => x !== a.id) : [...s.allergies, a.id] })} className={`min-h-10 rounded-full border px-3 text-sm ${on ? 'border-rose-600 bg-rose-600 text-white' : 'border-stone-300 bg-white'}`}>
                  {a.name}
                </button>
              );
            })}
          </div>
        </div>
        <label className="block">
          <span className="label">Ingredienser jeg ikke liker</span>
          <textarea className="input min-h-20" placeholder="F.eks. koriander, sopp, rosenkål" value={s.dislikes} onChange={(e) => set({ dislikes: e.target.value })} />
          <span className="text-xs text-stone-500">Skill med komma. Oppskrifter som inneholder ordene, foreslås ikke.</span>
        </label>
        <label className="block max-w-xs">
          <span className="label">Maks tilberedningstid</span>
          <select className="input" value={s.maxTime ?? ''} onChange={(e) => set({ maxTime: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Ingen grense</option>
            {[20, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} minutter</option>)}
          </select>
        </label>
      </Section>

      <Section title="Forslag og optimalisering">
        <label className="block">
          <span className="flex justify-between text-sm">
            <span>Treffe makroer</span>
            <span>Minst mulig svinn</span>
          </span>
          <input type="range" min={0} max={100} value={Math.round(s.wasteWeight * 100)} onChange={(e) => set({ wasteWeight: Number(e.target.value) / 100 })} className="h-8 w-full accent-brand-600" aria-label="Balanse mellom makroer og svinn" />
        </label>
        <Toggle checked={s.avoidRecent} onChange={(v) => set({ avoidRecent: v })} label="Unngå oppskrifter fra de siste to ukene" />
        <Toggle checked={s.preferFavorites} onChange={(v) => set({ preferFavorites: v })} label="Prioriter favoritter" />
        <label className="block">
          <span className="label">Filippinske retter</span>
          <select className="input" value={s.filippinsk} onChange={(e) => set({ filippinsk: e.target.value as typeof s.filippinsk })}>
            <option value="av">Ikke foreslå</option>
            <option value="normal">Som andre retter</option>
            <option value="ofte">Foreslå oftere</option>
          </select>
        </label>
        <Toggle checked={s.oversett} onChange={(v) => set({ oversett: v })} label="Vis engelske oppskrifter på norsk (ingredienser, mål og tittel)" />
      </Section>

      <Section title="Data" description="Alt lagres bare i denne nettleseren. Eksporter til en fil for å flytte mellom PC og mobil.">
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => exportData(data)}>
            <Icon name="download" className="h-4 w-4" /> Eksporter
          </button>
          <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" className="h-4 w-4" /> Importer
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const imported = await importData(f);
                if (!confirm('Dette erstatter alle innstillinger, planer og favoritter i denne nettleseren. Fortsette?')) return;
                update(() => imported);
                toast('Data er importert');
              } catch (err) {
                toast((err as Error).message);
              }
            }}
          />
          <button
            className="btn-ghost text-rose-700"
            onClick={() => {
              if (confirm('Slette alle innstillinger, planer, favoritter og avkrysninger?')) {
                update(() => defaultData());
                toast('Alt er tilbakestilt');
              }
            }}
          >
            Tilbakestill alt
          </button>
        </div>
      </Section>
    </div>
  );
}
