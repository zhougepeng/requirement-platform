import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return nextResolve(pathToFileURL(path.join(root, "scripts", "server-only.mjs")).href, context);
  }
  if (specifier.startsWith("@/")) {
    const target = pathToFileURL(path.join(root, "src", `${specifier.slice(2)}.ts`)).href;
    return nextResolve(target, context);
  }
  return nextResolve(specifier, context);
}
