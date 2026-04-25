import type { NextConfig } from "next";
import path from "path";

/** Radacina aplicatiei Next (repo root). */
const appRoot = path.resolve(process.cwd());

/**
 * In Docker, seteaza BACKEND_INTERNAL_URL (ex. http://backend:8765) la build pentru proxy /api.
 * Pe Vercel nu fortam rewrite catre localhost: backend-ul ruleaza ca functie Python in acelasi proiect.
 */
const nextConfig: NextConfig = {
    output: "standalone",
    // Evita inferenta gresita a monorepo (lockfile in parinte): standalone plat pentru Docker.
    outputFileTracingRoot: appRoot,
    turbopack: {
        root: appRoot,
    },
    async rewrites() {
        const defaultBackend = process.env.VERCEL ? "" : "http://127.0.0.1:8765";
        const backend = (process.env.BACKEND_INTERNAL_URL || defaultBackend).trim().replace(/\/$/, "");
        if (!backend) return [];
        return [{ source: "/api/:path*", destination: `${backend}/:path*` }];
    },
};

export default nextConfig;
