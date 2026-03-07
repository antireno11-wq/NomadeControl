import { redirect } from "next/navigation";
import { defaultRouteForRole, getCurrentUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await getCurrentUser();
  redirect(user ? defaultRouteForRole(user.role) : "/login");
}
