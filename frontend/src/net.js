// Connectivity: checks that the app's own service answers, and separately whether the wider internet is reachable.
import { useEffect, useState } from "react";
import { internetReachable, serviceReachable } from "./api.js";

export function useConnectivity() {
  const [state, set] = useState({ service: true, internet: false, checked: false });
  useEffect(() => {
    let live = true;
    const check = async () => {
      const [service, internet] = await Promise.all([serviceReachable(), internetReachable()]);
      if (live) set({ service, internet, checked: true });
    };
    check();
    const id = setInterval(check, 20000);
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    return () => { live = false; clearInterval(id); window.removeEventListener("online", check); window.removeEventListener("offline", check); };
  }, []);
  return state;
}
