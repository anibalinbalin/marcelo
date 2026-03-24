import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Placeholder for v1
const PLACEHOLDER_COMPANIES: Record<string, { name: string; ticker: string; sourceType: string }> = {
  "1": { name: "Grupo Bimbo", ticker: "BIMBOA", sourceType: "pdf" },
  "2": { name: "Grupo SBF / Centauro", ticker: "CENT", sourceType: "excel" },
};

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let company = PLACEHOLDER_COMPANIES[id] ?? { name: "Unknown", ticker: "???", sourceType: "unknown" };
  let runs: { id: number; quarter: string; status: string | null; createdAt: Date | null }[] = [];

  try {
    const { getCompany } = await import("@/app/actions/companies");
    const { getRuns } = await import("@/app/actions/runs");
    const dbCompany = await getCompany(parseInt(id));
    if (dbCompany) {
      company = { name: dbCompany.name, ticker: dbCompany.ticker, sourceType: dbCompany.sourceType };
      runs = await getRuns(dbCompany.id);
    }
  } catch {
    // DB not connected
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block">
          &larr; Back to dashboard
        </Link>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono text-sm text-muted-foreground">{company.ticker}</span>
              <Badge variant="outline" className="uppercase text-xs">{company.sourceType}</Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/companies/${id}/template`}>Upload Template</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/companies/${id}/mappings`}>Manage Mappings</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href={`/companies/${id}/upload`}>Upload New Quarter</Link>
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Extraction Runs</CardTitle>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <p>No extraction runs yet.</p>
                <p className="text-sm mt-1">Upload a quarterly report to get started.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quarter</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="font-mono">{run.quarter}</TableCell>
                      <TableCell><StatusBadge status={run.status ?? "pending"} /></TableCell>
                      <TableCell className="text-muted-foreground font-mono text-sm">
                        {run.createdAt ? new Date(run.createdAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/companies/${id}/runs/${run.id}`}>View</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
