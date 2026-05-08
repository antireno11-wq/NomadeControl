import { redirect } from "next/navigation";

export default function ResumenGeneralPage() {
  redirect("/operaciones?vista=historico");
}
