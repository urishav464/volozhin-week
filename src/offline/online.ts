// Whether the browser believes it has a connection — `navigator.onLine`, kept current by its online/offline events.
// «false» is reliable (no network at all); «true» only means maybe, so a failed request still says «maybe no connection».
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
