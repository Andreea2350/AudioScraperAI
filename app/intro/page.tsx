import { redirect } from "next/navigation";
import { LANDING_PATH } from "@/lib/routes";

/** Redirect permanent logic: /intro → landing pe domeniu curat. */
export default function IntroLegacyRedirect() {
    redirect(LANDING_PATH);
}
