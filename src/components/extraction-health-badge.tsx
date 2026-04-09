"use client";

import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 60_000;

type Health = {
  ok: boolean;
  latencyMs?: number;
  error?: string;
} | null;

async function fetchHealth(): Promise<Health> {
  try {
    const res = await fetch("/api/extraction-health", { cache: "no-store" });
    if (!res.ok) return { ok: false, error: `http ${res.status}` };
    return (await res.json()) as Health;
  } catch {
    return { ok: false, error: "fetch failed" };
  }
}

export function ExtractionHealthBadge() {
  const [health, setHealth] = useState<Health>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const h = await fetchHealth();
      if (!cancelled) setHealth(h);
    };

    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (health === null) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/40" />
        Extractor ...
      </div>
    );
  }

  const tooltip = health.ok
    ? `Extraction API online${health.latencyMs ? ` - ${health.latencyMs}ms` : ""}`
    : `Extraction API offline${health.error ? ` - ${health.error}` : ""}`;

  return (
    <div
      title={tooltip}
      className={
        health.ok
          ? "inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] text-success tabular-nums"
          : "inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-[11px] text-destructive tabular-nums"
      }
    >
      <span
        className={
          health.ok
            ? "size-1.5 rounded-full bg-success"
            : "size-1.5 rounded-full bg-destructive animate-pulse"
        }
      />
      {health.ok ? "Extractor online" : "Extractor offline"}
    </div>
  );
}
