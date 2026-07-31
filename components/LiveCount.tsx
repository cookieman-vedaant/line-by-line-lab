"use client";

import { useEffect, useState } from "react";
import { pingPresence } from "@/lib/apiClient";

/**
 * A small "● N online" chip showing how many people are using the app right now.
 * Sends a presence heartbeat every ~15s (paused while the tab is hidden) and
 * shows the count the server returns. Hides itself until it has a real count, so
 * it never displays a wrong or empty number.
 */
export default function LiveCount() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    async function ping() {
      if (document.hidden) return;
      const c = await pingPresence();
      if (active && c !== null) setCount(c);
    }

    void ping(); // immediate first heartbeat
    const id = setInterval(() => void ping(), 15_000);
    const onVisible = () => {
      if (!document.hidden) void ping();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (count === null || count < 1) return null;

  return (
    <span
      className="label-mono frame flex items-center gap-1.5 bg-paper-2 px-2.5 py-1 text-[10px] font-bold text-ink"
      title={`${count} ${count === 1 ? "person" : "people"} using the app right now`}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-70" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
      </span>
      {count} online
    </span>
  );
}
