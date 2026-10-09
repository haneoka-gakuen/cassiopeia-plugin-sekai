import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const base = fileURLToPath(new URL("..", import.meta.url));
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(base, "dist/example");
await mkdir(output, { recursive: true });
await build({ entryPoints: [path.join(base, "examples/demo.ts")], bundle: true, format: "esm", target: "es2022", outdir: output, loader: { ".woff2": "file" }, assetNames: "assets/[name]-[hash]" });
for (const file of ["index.html", "messages.json", "sample.json"]) await copyFile(path.join(base, "examples", file), path.join(output, file));
console.log(output);
