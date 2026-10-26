// Felles typer for innhentingsskriptet og appen.

export interface Nutrition {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export type Department =
  | 'frukt_gront'
  | 'kjott_fisk'
  | 'meieri'
  | 'brod_bakevarer'
  | 'torrvarer'
  | 'hermetikk'
  | 'krydder'
  | 'frysevarer'
  | 'annet';

export type Allergen =
  | 'gluten'
  | 'laktose'
  | 'notter'
  | 'peanotter'
  | 'skalldyr'
  | 'fisk'
  | 'egg'
  | 'soya'
  | 'selleri'
  | 'sennep'
  | 'sesam';

export type Category =
  | 'vegetar'
  | 'vegansk'
  | 'pescetar'
  | 'lavkarbo'
  | 'keto'
  | 'hoyprotein'
  | 'sunt'
  | 'middelhav'
  | 'filippinsk';

export type PriceStore = 'oda' | 'meny';

/** Typisk pris for en vare i én butikk. */
export interface StorePrice {
  /** Kroner per kjøpsenhet (per g, ml eller stk). */
  perUnit: number;
  /** Produktet prisen er hentet fra. */
  product: string;
  url?: string;
}

/** Informasjon om en normalisert ingrediens slik appen trenger den. */
export interface IngredientInfo {
  name: string;
  dept: Department;
  /** Enheten varen kjøpes i: gram, milliliter eller stykk. */
  buyUnit: 'g' | 'ml' | 'stk';
  /** Vanlige pakningsstørrelser i buyUnit (f.eks. [400, 800] for kjøttdeig). */
  packages: number[];
  /** Gram per buyUnit (1 for g, tetthet for ml, vekt per stk for stk). */
  gramsPerUnit: number;
  /** Ferskvare som blir dårlig om den ikke brukes. */
  perishable: boolean;
  /** Basisvare som de fleste har hjemme (salt, pepper, olje). */
  basis: boolean;
  per100g: Nutrition;
  nutritionSource: 'matvaretabellen' | 'matinfo' | 'ordbok';
  /** Navnet på matvaren i Matvaretabellen som næringen kommer fra. */
  mvtName?: string;
  /** Navn på stk-enheten i entall og flertall, f.eks. ["boks", "bokser"]. */
  label?: [string, string];
  /** Priser fra nettbutikkene, når varen ble funnet der. */
  prices?: Partial<Record<PriceStore, StorePrice>>;
}

export interface RecipeIngredient {
  raw: string;
  id?: string;
  amount?: number;
  unit?: string;
  /** Gram for hele oppskriften. */
  grams?: number;
  /** Næring for hele oppskriftens mengde av denne ingrediensen. */
  nutrition?: Nutrition;
  /** Mengde i ingrediensens kjøpsenhet for hele oppskriften. */
  buyAmount?: number;
}

export interface Recipe {
  id: string;
  source: string;
  sourceName: string;
  url: string;
  name: string;
  /** Språkkode når oppskriften ikke er på norsk (f.eks. "en"). */
  language?: string;
  image?: string;
  totalTime?: number;
  servings: number;
  ingredients: RecipeIngredient[];
  instructions?: string[];
  perServing: Nutrition;
  siteNutrition?: Partial<Nutrition>;
  uncertain: boolean;
  matchedShare: number;
  categories: Category[];
  allergens: Allergen[];
  mainProtein: string;
  firstSeen: string;
  lastSeen: string;
}

export interface RecipesFile {
  version: 1;
  generatedAt: string;
  lagreFremgangsmate: boolean;
  /** Når prisene sist ble hentet (YYYY-MM-DD). */
  pricesDate?: string;
  ingredients: Record<string, IngredientInfo>;
  recipes: Recipe[];
}
