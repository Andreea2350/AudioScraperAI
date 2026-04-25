import type { NextConfig } from "next";
import path from "path";

/** Radacina aplicatiei Next (folderul `frontend/`); la `npm run build` cwd trebuie sa fie aici. */
const appRoot = path.resolve(process.cwd());

/**
 * In productie / Docker, seteaza BACKEND_INTERNAL_URL la URL-ul din reteaua interna
 * (ex. http://backend:8765) inainte de `next build`, ca rewrite-urile sa pointeze corect.
 * In dev local, implicit http://127.0.0.1:8765 (acelasi host ca browserul).
 */
const nextConfig: NextConfig = {
    output: "standalone",
    // Evita inferenta gresita a monorepo (lockfile in parinte): standalone plat pentru Docker.
    outputFileTracingRoot: appRoot,
    turbopack: {
        root: appRoot,
    },
    async rewrites() {
        const backend = (process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:8765").replace(
            /\/$/,
            "",
        );
        return [{ source: "/api/:path*", destination: `${backend}/:path*` }];
    },
};

export default nextConfig;
