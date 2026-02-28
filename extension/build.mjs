import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  minify: !watch,
  sourcemap: watch,
  target: "es2022",
  format: "esm",
};

/** Copy static files (manifest, popup, icons) into dist/. */
function copyStatic() {
  fs.mkdirSync("dist", { recursive: true });

  // manifest.json
  fs.copyFileSync("manifest.json", "dist/manifest.json");

  // popup files
  fs.copyFileSync("src/popup/popup.html", "dist/popup.html");
  fs.copyFileSync("src/popup/popup.js", "dist/popup.js");

  // icons (if any exist)
  if (fs.existsSync("icons")) {
    fs.mkdirSync("dist/icons", { recursive: true });
    for (const f of fs.readdirSync("icons")) {
      fs.copyFileSync(path.join("icons", f), path.join("dist/icons", f));
    }
  }
}

async function build() {
  copyStatic();

  // Content script
  await esbuild.build({
    ...common,
    entryPoints: ["src/content/content-script.ts"],
    outfile: "dist/content-script.js",
    format: "iife", // content scripts must be IIFE
  });

  // Service worker
  await esbuild.build({
    ...common,
    entryPoints: ["src/background/service-worker.ts"],
    outfile: "dist/service-worker.js",
  });

  console.log("Build complete.");
}

if (watch) {
  copyStatic();
  const ctx1 = await esbuild.context({
    ...common,
    entryPoints: ["src/content/content-script.ts"],
    outfile: "dist/content-script.js",
    format: "iife",
  });
  const ctx2 = await esbuild.context({
    ...common,
    entryPoints: ["src/background/service-worker.ts"],
    outfile: "dist/service-worker.js",
  });
  await Promise.all([ctx1.watch(), ctx2.watch()]);
  console.log("Watching for changes...");
} else {
  await build();
}
