import { useCallback, useEffect, useRef, useState } from 'react';
import { loadData, saveData } from './storage.ts';
import type { UserData } from './types.ts';

/** Brukerdata i localStorage. `update` tar en funksjon som returnerer ny tilstand. */
export function useUserData() {
  const [data, setData] = useState<UserData>(() => loadData());
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    saveData(data);
  }, [data]);
  // Hold flere faner i synk.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'middagsplanlegger:v1') setData(loadData());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const update = useCallback((fn: (d: UserData) => UserData) => setData((d) => fn(d)), []);
  return [data, update, setData] as const;
}
