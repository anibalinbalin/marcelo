import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";

// Placeholder data for v1 (before DB is connected)
const PLACEHOLDER_COMPANIES = [
  { id: 1, name: "Grupo Bimbo", ticker: "BIMBOA", sourceType: "pdf", lastRun: null },
  { id: 2, name: "Grupo SBF / Centauro", ticker: "CENT", sourceType: "excel", lastRun: null },
];

export default async function DashboardPage() {
  let companiesData = PLACEHOLDER_COMPANIES;

  try {
    const { getCompanies } = await import("@/app/actions/companies");
    const dbCompanies = await getCompanies();
    if (dbCompanies.length > 0) {
      companiesData = dbCompanies.map((c) => ({
        id: c.id,
        name: c.name,
        ticker: c.ticker,
        sourceType: c.sourceType,
        lastRun: null,
      }));
    }
  } catch {
    // DB not connected yet — use placeholder
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Report Populator</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Quarterly financial report auto-populator
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/companies/new">Add Company</Link>
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {companiesData.map((company) => (
            <Link key={company.id} href={`/companies/${company.id}`}>
              <Card className="hover:border-primary/40 transition-colors cursor-pointer">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{company.name}</CardTitle>
                    <Badge variant="outline" className="uppercase text-xs">
                      {company.sourceType}
                    </Badge>
                  </div>
                  <p className="font-mono text-sm text-muted-foreground">{company.ticker}</p>
                </CardHeader>
                <CardContent>
                  {company.lastRun ? (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Last run:</span>
                      <span className="font-mono">{/* quarter */}</span>
                      <StatusBadge status="approved" />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No extraction runs yet</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
