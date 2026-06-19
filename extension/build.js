import * as esbuild from "esbuild";

const entries = [
  ["src/content/inject.js", "dist/content.js"],
  ["src/background/service-worker.js", "dist/background.js"],
];

for (const [entryPoint, outfile] of entries) {
  await esbuild.build({ entryPoints: [entryPoint], outfile, bundle: true, format: "iife" });
}

console.log("Built extension bundles into dist/");
