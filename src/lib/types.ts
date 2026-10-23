import type { Allergen } from '../../shared/types.ts';

export const DAYS = ['man', 'tir', 'ons', 'tor', 'fre', 'lor', 'son'] as const;
export type Day = (typeof DAYS)[number];

export const DAY_NAMES: Record<Day, string> = {
  man: 'Mandag',
  tir: 'Tirsdag',
  ons: 'Onsdag',
  tor: 'Torsdag',
  fre: 'Fredag',
  lor: 'Lørdag',
  son: 'Søndag',
};

export const DAY_SHORT: Record<Day, string> = {
  man: 'Man', tir: 'Tir', ons: 'Ons', tor: 'Tor', fre: 'Fre', lor: 'Lør', son: 'Søn',
};

export type DietCategory = 'sunt' | 'blandet' | 'keto' | 'lavkarbo' | 'vegetar' | 'hoyprotein' | 'middelhav';

export interface Macros {
  protein: number;
  fat: number;
  carbs: number;
}

export interface Settings {
  dietMode: 'kategori' | 'makro';
  dietCategory: DietCategory;
  macroUnit: 'prosent' | 'gram';
  /** Andel av energien i prosent, summerer til 100. */
  macroPercent: Macros;
  /** Gram per dag. */
  macroGrams: Macros;
  calorieMode: 'lik' | 'perDag';
  dailyKcal: number;
  dailyKcalPerDay: Record<Day, number>;
  /** Andel av dagens kalorier som middagen skal dekke (0–1). */
  dinnerShare: number;
  days: Day[];
  servings: Record<Day, number>;
  /** Lag ekstra porsjoner på `from` og spis restene på `to`. */
  leftovers: { from: Day; to: Day }[];
  allergies: Allergen[];
  dislikes: string;
  maxTime: number | null;
  /** 0 = bare treffe makroer, 1 = bare minst mulig svinn. */
  wasteWeight: number;
  avoidRecent: boolean;
  preferFavorites: boolean;
}

export interface PlanDay {
  day: Day;
  /** Antall som spiser denne dagen. */
  servings: number;
  recipeId: string | null;
  locked: boolean;
  /** Dagen spiser rester fra denne dagen. */
  leftoverFrom?: Day;
}

export interface WeekPlan {
  id: string;
  createdAt: string;
  /** Mandagen i uken planen gjelder (YYYY-MM-DD). */
  weekStart: string;
  days: PlanDay[];
}

export interface UserData {
  version: 1;
  settings: Settings;
  currentPlan: WeekPlan | null;
  history: WeekPlan[];
  favorites: string[];
  /** Brukerens vurdering av oppskrifter, 1–5 stjerner. */
  ratings: Record<string, number>;
  /** Oppskrifter brukeren ikke liker. Disse foreslås aldri. */
  hidden: string[];
  /** Avkrysninger i handlelisten per plan-ID og vare-nøkkel. */
  checked: Record<string, Record<string, boolean>>;
  /** Varer brukeren har hjemme (overstyrer standard basisvarer). */
  atHome: Record<string, boolean>;
}
