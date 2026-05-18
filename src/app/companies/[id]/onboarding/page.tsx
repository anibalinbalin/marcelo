import { notFound } from "next/navigation";
import { getCompany } from "@/app/actions/companies";
import { OnboardingClient } from "./onboarding-client";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CompanyOnboardingPage({ params }: Props) {
  const { id } = await params;
  const companyId = parseInt(id, 10);
  if (Number.isNaN(companyId)) notFound();

  const company = await getCompany(companyId);
  if (!company) notFound();

  return (
    <OnboardingClient
      company={{ id: company.id, name: company.name, ticker: company.ticker }}
    />
  );
}
