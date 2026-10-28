import { useEffect, useRef } from "react";

import { getQueue, subscribe } from "@/src/offline/store";

/** Vuelve a cargar la pantalla cuando cambian los pendientes (p. ej. al terminar de sincronizar). */
export function useOfflineRefresh(reload: () => void) {
  const ref = useRef(reload);
  ref.current = reload;
  useEffect(() => {
    let last = getQueue().length;
    return subscribe(() => {
      const n = getQueue().length;
      if (n !== last) {
        last = n;
        ref.current();
      }
    });
  }, []);
}
