"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCwIcon, SparklesIcon, XIcon } from "lucide-react";

const POLL_INTERVAL_MS = 60_000;
const SEEN_VERSION_KEY = "changelog-seen-version";

type VersionInfo = { version: string; sha: string };
type ChangelogEntry = { version: string; changes: string[] };

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

async function fetchChangelog(): Promise<ChangelogEntry[]> {
  try {
    const res = await fetch("/changelog.json", { cache: "no-store" });
    if (!res.ok) return [];
    return (await res.json()) as ChangelogEntry[];
  } catch {
    return [];
  }
}

export function VersionWatcher() {
  const [current, setCurrent] = useState<VersionInfo | null>(null);
  const [latest, setLatest] = useState<VersionInfo | null>(null);
  const [changelogEntry, setChangelogEntry] = useState<ChangelogEntry | null>(
    null,
  );
  const [dismissed, setDismissed] = useState(false);
  const initialRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const v = await fetchVersion();
      if (cancelled || !v) return;
      initialRef.current = v.sha;
      setCurrent(v);

      const seenVersion = localStorage.getItem(SEEN_VERSION_KEY);
      if (seenVersion !== v.version) {
        const entries = await fetchChangelog();
        const entry = entries.find((e) => e.version === v.version);
        if (entry && !cancelled) {
          setChangelogEntry(entry);
        }
      }
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

  function dismissChangelog() {
    if (current) {
      localStorage.setItem(SEEN_VERSION_KEY, current.version);
    }
    setDismissed(true);
    setChangelogEntry(null);
  }

  if (!current) return null;

  const updateAvailable =
    latest !== null &&
    initialRef.current !== null &&
    latest.sha !== initialRef.current;

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

  if (changelogEntry && !dismissed) {
    return (
      <>
        <div className="fixed bottom-3 left-3 z-50 w-80 rounded-lg border border-white/10 bg-zinc-900/95 p-4 shadow-lg backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <SparklesIcon className="size-4 text-amber-400" />
              What&apos;s new in v{changelogEntry.version}
            </div>
            <button
              type="button"
              onClick={dismissChangelog}
              className="rounded p-0.5 text-zinc-400 transition-colors hover:text-white"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
          <ul className="space-y-1.5 text-xs text-zinc-300">
            {changelogEntry.changes.map((change) => (
              <li key={change} className="flex gap-2">
                <span className="mt-1 block size-1 shrink-0 rounded-full bg-zinc-500" />
                {change}
              </li>
            ))}
          </ul>
        </div>
      </>
    );
  }

  return (
    <div className="fixed bottom-3 left-3 z-50 pointer-events-none rounded-full border border-white/10 bg-zinc-900/80 px-2.5 py-1 font-mono text-[11px] text-white tabular-nums shadow-sm backdrop-blur-sm">
      v{current.version}
    </div>
  );
}
