import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Allergen, Department } from '../../shared/types.ts';

export interface DictIngredient {
  name: string;
  dept: Department;
  synonyms: string[];
  buy: 'g' | 'ml' | 'stk';
  packages: number[];
  gpu?: number;
  label?: [string, string];
  density?: number;
  units?: Record<string, number>;
  perishable: boolean;
  basis?: boolean;
  tags?: string[];
  allergens?: Allergen[];
  protein?: string;
  mvt: string;
  mvtId?: string;
  n: [number, number, number, number];
}

export interface DictUnits {
  volumeMl: Record<string, number>;
  massG: Record<string, number>;
  aliases: Record<string, string>;
  containerUnits: string[];
  fallbackGrams: Record<string, number>;
}

export interface Dictionary {
  units: DictUnits;
  ingredients: Record<string, DictIngredient>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCRAPER_DIR = path.resolve(here, '..');
export const ROOT_DIR = path.resolve(SCRAPER_DIR, '..');

export function loadDictionary(file = path.join(SCRAPER_DIR, 'ingredients.json')): Dictionary {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { units: raw.units, ingredients: raw.ingredients };
}

/** Gram per kjøpsenhet. */
export function gramsPerBuyUnit(ing: DictIngredient): number {
  if (ing.gpu) return ing.gpu;
  if (ing.buy === 'ml') return ing.density ?? 1;
  return 1;
}
