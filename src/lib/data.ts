import { useEffect, useMemo, useState } from 'react';
import type { Recipe, RecipesFile } from '../../shared/types.ts';

export interface RecipeData {
  file: RecipesFile;
  byId: Map<string, Recipe>;
}

/** Laster oppskriftene fra public/data/recipes.json. */
export function useRecipeData(): { data: RecipeData | null; error: string | null } {
  const [file, setFile] = useState<RecipesFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/recipes.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((f: RecipesFile) => setFile(f))
      .catch((e) => setError(`Kunne ikke laste oppskriftene (${e.message}). Har innhentingen kjørt?`));
  }, []);
  const data = useMemo(() => (file ? { file, byId: new Map(file.recipes.map((r) => [r.id, r])) } : null), [file]);
  return { data, error };
}
