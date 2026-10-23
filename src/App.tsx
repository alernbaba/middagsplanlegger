import { useCallback, useEffect, useState } from 'react';
import { HistoryView } from './components/HistoryView.tsx';
import { PlanView } from './components/PlanView.tsx';
import { RecipesView } from './components/RecipesView.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { ShoppingView } from './components/ShoppingView.tsx';
import { Icon, Toast } from './components/ui.tsx';
import { useRecipeData } from './lib/data.ts';
import { useUserData } from './lib/store.ts';

const TABS = [
  { id: 'plan', label: 'Ukeplan', icon: 'calendar' },
  { id: 'handleliste', label: 'Handleliste', icon: 'cart' },
  { id: 'oppskrifter', label: 'Oppskrifter', icon: 'book' },
  { id: 'historikk', label: 'Historikk', icon: 'history' },
  { id: 'innstillinger', label: 'Innstillinger', icon: 'settings' },
] as const;
type Tab = (typeof TABS)[number]['id'];

function tabFromHash(): Tab {
  const h = location.hash.replace('#', '');
  return (TABS.find((t) => t.id === h)?.id ?? 'plan') as Tab;
}

export default function App() {
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const [data, update] = useUserData();
  const { data: rd, error } = useRecipeData();
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toast = useCallback((m: string) => setToastMsg(m), []);
  const clearToast = useCallback(() => setToastMsg(null), []);

  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const setTab = (t: Tab) => {
    location.hash = t;
    window.scrollTo({ top: 0 });
  };

  let content;
  if (tab === 'innstillinger') content = <SettingsView data={data} update={update} toast={toast} />;
  else if (error) content = <p className="card p-4 text-rose-800">{error}</p>;
  else if (!rd) content = <p className="p-8 text-center text-stone-500">Laster oppskrifter …</p>;
  else if (rd.file.recipes.length === 0)
    content = <p className="card p-4">Ingen oppskrifter ennå. Kjør innhentingen («Hent oppskrifter» under Actions på GitHub) – se README.</p>;
  else if (tab === 'plan') content = <PlanView data={data} update={update} rd={rd} toast={toast} />;
  else if (tab === 'handleliste') content = <ShoppingView data={data} update={update} rd={rd} toast={toast} />;
  else if (tab === 'oppskrifter') content = <RecipesView data={data} update={update} rd={rd} toast={toast} />;
  else content = <HistoryView data={data} update={update} rd={rd} toast={toast} goToPlan={() => setTab('plan')} />;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a href="#plan" className="flex items-center gap-2 font-bold text-brand-700">
            <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" className="h-8 w-8" />
            Middagsplanlegger
          </a>
          <nav className="hidden gap-1 md:flex" aria-label="Hovedmeny">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined} className={`btn ${tab === t.id ? 'bg-brand-50 text-brand-700' : 'text-stone-600 hover:bg-stone-100'}`}>
                <Icon name={t.icon} className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="pb-safe mx-auto max-w-6xl px-4 pt-4">{content}</main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Hovedmeny">
        <div className="grid grid-cols-5">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined} className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px] ${tab === t.id ? 'text-brand-700' : 'text-stone-500'}`}>
              <Icon name={t.icon} className="h-6 w-6" />
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {toastMsg && <Toast message={toastMsg} onDone={clearToast} />}
    </div>
  );
}
