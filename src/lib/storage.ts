import { DAYS, type Day, type Settings, type UserData, type WeekPlan } from './types.ts';

const KEY = 'middagsplanlegger:v1';

const perDay = <T,>(v: T) => Object.fromEntries(DAYS.map((d) => [d, v])) as Record<Day, T>;

export function defaultSettings(): Settings {
  return {
    dietMode: 'kategori',
    dietCategory: 'blandet',
    macroUnit: 'prosent',
    macroPercent: { protein: 25, fat: 35, carbs: 40 },
    macroGrams: { protein: 130, fat: 80, carbs: 220 },
    calorieMode: 'lik',
    dailyKcal: 2200,
    dailyKcalPerDay: perDay(2200),
    dinnerShare: 0.35,
    days: ['man', 'tir', 'ons', 'tor', 'fre'],
    servings: perDay(2),
    leftovers: [],
    allergies: [],
    dislikes: '',
    maxTime: 60,
    wasteWeight: 0.5,
    avoidRecent: true,
    preferFavorites: true,
    filippinsk: 'normal',
    oversett: true,
  };
}

export function defaultData(): UserData {
  return { version: 1, settings: defaultSettings(), currentPlan: null, history: [], favorites: [], ratings: {}, hidden: [], checked: {}, atHome: {} };
}

/** Fyller inn manglende felt, slik at eldre eller importerte data fungerer. */
export function normalizeData(raw: unknown): UserData {
  const base = defaultData();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<UserData>;
  const settings = { ...base.settings, ...(r.settings ?? {}) };
  settings.servings = { ...base.settings.servings, ...(r.settings?.servings ?? {}) };
  settings.dailyKcalPerDay = { ...base.settings.dailyKcalPerDay, ...(r.settings?.dailyKcalPerDay ?? {}) };
  return {
    version: 1,
    settings,
    currentPlan: r.currentPlan ?? null,
    history: Array.isArray(r.history) ? r.history : [],
    favorites: Array.isArray(r.favorites) ? r.favorites : [],
    ratings: r.ratings && typeof r.ratings === 'object' ? r.ratings : {},
    hidden: Array.isArray(r.hidden) ? r.hidden : [],
    checked: r.checked && typeof r.checked === 'object' ? r.checked : {},
    atHome: r.atHome && typeof r.atHome === 'object' ? r.atHome : {},
  };
}

export function loadData(): UserData {
  try {
    const s = localStorage.getItem(KEY);
    return s ? normalizeData(JSON.parse(s)) : defaultData();
  } catch {
    return defaultData();
  }
}

export function saveData(d: UserData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // Full lagring eller privat modus: appen fungerer videre uten å lagre.
  }
}

export function exportData(d: UserData) {
  const blob = new Blob([JSON.stringify({ ...d, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `middagsplanlegger-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importData(file: File): Promise<UserData> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed || parsed.version !== 1 || !parsed.settings) throw new Error('Filen ser ikke ut som en eksport fra Middagsplanleggeren.');
  return normalizeData(parsed);
}

/** Mandagen i uken for en dato, som YYYY-MM-DD. */
export function mondayOf(date = new Date()): string {
  const d = new Date(date);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ISO-ukenummer. */
export function weekNumber(isoDate: string): number {
  const d = new Date(isoDate + 'T12:00:00');
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Oppskrifter brukt i planer de siste 14 dagene før `weekStart`. */
export function recentRecipeIds(history: WeekPlan[], weekStart: string, excludePlanId?: string): Set<string> {
  const start = new Date(weekStart + 'T12:00:00').getTime();
  const ids = new Set<string>();
  for (const p of history) {
    if (p.id === excludePlanId) continue;
    const t = new Date(p.weekStart + 'T12:00:00').getTime();
    const daysBefore = (start - t) / 86400000;
    if (daysBefore > 0 && daysBefore <= 14) for (const d of p.days) if (d.recipeId) ids.add(d.recipeId);
  }
  return ids;
}
