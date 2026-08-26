import { FeishuLoginCard } from "@/components/feishu-login-card";
import { safeReturnTo } from "@/services/auth/session";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; error?: string }> }) {
  const query = await searchParams;
  return <FeishuLoginCard returnTo={safeReturnTo(query.returnTo)} initialError={query.error} />;
}
