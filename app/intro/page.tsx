import { redirect } from "next/navigation";
import { LANDING_PATH } from "@/lib/routes";

/**
 * Pagina /intro e veche: candva era pagina de prezentare, acum prezentarea sta direct pe "/".
 * Ca sa nu pice link-urile vechi, oricine intra pe /intro e trimis automat la landing.
 */
export default function IntroLegacyRedirect() {
    // redirect() opreste randarea si trimite imediat catre pagina de prezentare.
    redirect(LANDING_PATH);
}
