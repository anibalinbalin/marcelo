"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCwIcon } from "lucide-react";

const POLL_INTERVAL_MS = 60_000;

async function fetchVersion(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { version?: string };
    return json.version ?? null;
  } catch {
    return null;
  }
}

export function VersionWatcher() {
  const [current, setCurrent] = useState<string | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const initialRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const v = await fetchVersion();
      if (cancelled || !v) return;
      initialRef.current = v;
      setCurrent(v);
    })();

    const id = setInterval(async () => {
      const v = await fetchVersion();
      if (cancelled || !v) return;
      setLatest(v);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!current) return null;

  const updateAvailable =
    latest !== null && initialRef.current !== null && latest !== initialRef.current;

  if (updateAvailable) {
    const short = (latest ?? "").slice(0, 7);
    return (
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full border border-info/30 bg-info/10 px-3 py-1.5 text-xs text-info shadow-sm backdrop-blur transition-all hover:bg-info/15 active:scale-[0.97]"
      >
        <RefreshCwIcon className="size-3.5" />
        <span>New version available - click to refresh</span>
        <span className="font-mono opacity-60">{short}</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-3 left-3 z-50 pointer-events-none rounded-full bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/60 tabular-nums">
      v {current.slice(0, 7)}
    </div>
  );
}
