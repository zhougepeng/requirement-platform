import { FeishuLoginCard } from "@/components/feishu-login-card";
import { safeReturnTo } from "@/services/auth/session";
import { redirect } from "next/navigation";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; error?: string; tenantKey?: string }> }) {
  const query = await searchParams;
  const returnTo = safeReturnTo(query.returnTo);
  if (!query.error && !query.tenantKey) redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  return <FeishuLoginCard returnTo={returnTo} initialError={query.error} tenantKey={query.tenantKey} />;
}
