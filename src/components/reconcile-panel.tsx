"use client";

import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { ReconciliationResult } from "@/lib/extraction/reconcile-simultaneas";

function formatCLP(n: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function formatCLPShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(0)}M`;
  return formatCLP(n);
}

export function ReconcilePanel() {
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const refA = useRef<HTMLInputElement>(null);
  const refB = useRef<HTMLInputElement>(null);

  async function handleSubmit() {
    if (!fileA || !fileB) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append("fileA", fileA);
    form.append("fileB", fileB);

    try {
      const res = await fetch("/api/reconcile", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Reconciliation failed");
      setResult(json as ReconciliationResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subir extractos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-mono">Día A (más antiguo)</p>
              <div
                className="border-2 border-dashed rounded-md p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => refA.current?.click()}
              >
                <p className="text-sm">
                  {fileA ? fileA.name : "Haz clic o arrastra un PDF"}
                </p>
              </div>
              <input
                ref={refA}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => setFileA(e.target.files?.[0] ?? null)}
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-mono">Día B (más reciente)</p>
              <div
                className="border-2 border-dashed rounded-md p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => refB.current?.click()}
              >
                <p className="text-sm">
                  {fileB ? fileB.name : "Haz clic o arrastra un PDF"}
                </p>
              </div>
              <input
                ref={refB}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => setFileB(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <Button
            disabled={!fileA || !fileB || loading}
            onClick={handleSubmit}
            className="w-full"
          >
            {loading ? "Procesando..." : "Reconciliar"}
          </Button>
          {error && (
            <p className="text-sm text-destructive font-mono">{error}</p>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <>
          {/* Summary */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  Resumen — {result.dateA} → {result.dateB}
                </CardTitle>
                <div className="flex gap-2">
                  <Badge variant="destructive">
                    {result.summary.simultaneasTerminated} terminadas
                  </Badge>
                  <Badge className="bg-green-600 hover:bg-green-700">
                    {result.summary.simultaneasCreated} nuevas
                  </Badge>
                  <Badge variant="outline">
                    {result.summary.simultaneasPersistent} persistentes
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Interés pagado</p>
                  <p className="font-mono font-semibold text-amber-500">
                    {formatCLPShort(result.summary.totalInterestPaid)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Comisión pagada</p>
                  <p className="font-mono font-semibold">
                    {formatCLPShort(result.summary.totalCommissionPaid)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Δ Financiamiento</p>
                  <p className={`font-mono font-semibold ${result.summary.netFinancingChange < 0 ? "text-destructive" : "text-green-500"}`}>
                    {formatCLPShort(result.summary.netFinancingChange)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Terminated */}
          {result.terminated.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-destructive">
                  Terminadas ({result.terminated.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.terminated.map((t) => (
                  <div key={t.simultanea.folio} className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold">{t.simultanea.nemo}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            folio {t.simultanea.folio}
                          </span>
                          <Badge variant={t.type === "vencimiento" ? "outline" : "secondary"} className="text-[10px] px-1.5 py-0">
                            {t.type === "vencimiento" ? "Vencimiento" : "Precancelación"}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground text-xs mt-1">
                          Desde {t.simultanea.fechaInicial} · Tasa {t.simultanea.tasa}% · {t.simultanea.dias} días
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-xs text-muted-foreground">Compromiso día A</p>
                        <p className="font-mono font-semibold">{formatCLPShort(t.simultanea.compromiso)}</p>
                      </div>
                    </div>
                    {t.cashSettlement && (
                      <>
                        <Separator className="my-2" />
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">
                            Liquidación ref {t.cashSettlement.referencia}
                          </span>
                          <span className="font-mono">
                            Cargo {formatCLPShort(t.cashSettlement.cargo ?? 0)}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs mt-1">
                          <span className="text-muted-foreground">Interés total</span>
                          <span className={`font-mono font-semibold ${t.interestTotal >= 0 ? "text-amber-500" : "text-destructive"}`}>
                            {formatCLPShort(t.interestTotal)}
                          </span>
                        </div>
                      </>
                    )}
                    {!t.cashSettlement && (
                      <p className="text-xs text-amber-500 mt-2">⚠ Sin match en movimientos de caja</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Created */}
          {result.created.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-green-600">
                  Nuevas ({result.created.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.created.map((c) => (
                  <div key={c.simultanea.folio} className="rounded-md border border-green-600/20 bg-green-600/5 p-3 text-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold">{c.simultanea.nemo}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            folio {c.simultanea.folio}
                          </span>
                        </div>
                        <p className="text-muted-foreground text-xs mt-1">
                          Hasta {c.simultanea.fechaFinal} · Tasa {c.simultanea.tasa}% · {c.simultanea.dias} días
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-xs text-muted-foreground">Principal</p>
                        <p className="font-mono font-semibold">{formatCLPShort(c.simultanea.principal)}</p>
                      </div>
                    </div>
                    {c.cashCreation && (
                      <>
                        <Separator className="my-2" />
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">
                            Creación ref {c.cashCreation.referencia}
                          </span>
                          <span className="font-mono">
                            Abono {formatCLPShort(c.cashCreation.abono ?? 0)}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs mt-1">
                          <span className="text-muted-foreground">Comisión</span>
                          <span className="font-mono font-semibold">
                            {formatCLPShort(c.commission)}
                          </span>
                        </div>
                      </>
                    )}
                    {!c.cashCreation && (
                      <p className="text-xs text-amber-500 mt-2">⚠ Sin match en movimientos de caja</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Persistent */}
          {result.persistent.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-muted-foreground">
                  Persistentes ({result.persistent.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {result.persistent.map((p) => (
                    <div key={p.dayA.folio} className="flex items-center justify-between text-sm rounded border px-3 py-2">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-semibold w-20">{p.dayA.nemo}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          folio {p.dayA.folio}
                        </span>
                      </div>
                      <div className="flex items-center gap-6 text-xs">
                        <div className="text-right">
                          <p className="text-muted-foreground">Compromiso A</p>
                          <p className="font-mono">{formatCLPShort(p.dayA.compromiso)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-muted-foreground">Compromiso B</p>
                          <p className="font-mono">{formatCLPShort(p.dayB.compromiso)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-muted-foreground">Δ Accrual</p>
                          <p className="font-mono text-amber-500">
                            +{formatCLPShort(p.dailyAccrual)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Unmatched */}
          {result.unmatched.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-amber-500">
                  Sin match ({result.unmatched.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.unmatched.map((m, i) => (
                  <div key={i} className="flex justify-between text-xs font-mono border rounded px-3 py-2 bg-amber-500/5">
                    <span>{m.fecha} ref {m.referencia} — {m.descripcion}</span>
                    <span>
                      {m.cargo != null ? `Cargo ${formatCLPShort(m.cargo)}` : `Abono ${formatCLPShort(m.abono ?? 0)}`}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
