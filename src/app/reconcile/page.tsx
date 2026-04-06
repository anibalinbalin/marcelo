import { ReconcilePanel } from "@/components/reconcile-panel";

export default function ReconcilePage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Reconciliación Simultáneas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Compara dos extractos LarrainVial e identifica terminadas, nuevas y persistentes
          </p>
        </div>
        <ReconcilePanel />
      </div>
    </div>
  );
}
