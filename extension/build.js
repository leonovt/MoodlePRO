import * as esbuild from "esbuild";

// Server the built extension talks to. Defaults to production; override for local dev with
// MOODLEPRO_SERVER_URL=http://localhost:8000 npm run build
const SERVER_BASE_URL = process.env.MOODLEPRO_SERVER_URL || "https://151.145.95.59.sslip.io";

const entries = [
  ["src/content/inject.js", "dist/content.js"],
  ["src/background/service-worker.js", "dist/background.js"],
];

for (const [entryPoint, outfile] of entries) {
  await esbuild.build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format: "iife",
    define: { __SERVER_BASE_URL__: JSON.stringify(SERVER_BASE_URL) },
  });
}

console.log(`Built with server base URL: ${SERVER_BASE_URL}`);

console.log("Built extension bundles into dist/");
