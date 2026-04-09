"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCwIcon } from "lucide-react";

const POLL_INTERVAL_MS = 60_000;

type VersionInfo = { version: string; sha: string };

async function fetchVersion(): Promise<VersionInfo | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { version?: string; sha?: string };
    if (!json.version || !json.sha) return null;
    return { version: json.version, sha: json.sha };
  } catch {
    return null;
  }
}

export function VersionWatcher() {
  const [current, setCurrent] = useState<VersionInfo | null>(null);
  const [latest, setLatest] = useState<VersionInfo | null>(null);
  const initialRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const v = await fetchVersion();
      if (cancelled || !v) return;
      initialRef.current = v.sha;
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
    latest !== null && initialRef.current !== null && latest.sha !== initialRef.current;

  if (updateAvailable) {
    return (
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full border border-info/30 bg-info/10 px-3 py-1.5 text-xs text-info shadow-sm backdrop-blur transition-all hover:bg-info/15 active:scale-[0.97]"
      >
        <RefreshCwIcon className="size-3.5" />
        <span>New version available - click to refresh</span>
        <span className="font-mono opacity-80">v{latest?.version}</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-3 left-3 z-50 pointer-events-none rounded-full border border-white/10 bg-zinc-900/80 px-2.5 py-1 font-mono text-[11px] text-white tabular-nums shadow-sm backdrop-blur-sm">
      v{current.version}
    </div>
  );
}
