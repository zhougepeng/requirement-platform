import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const staticSource = resolve(projectRoot, ".next", "static");
const staticTarget = resolve(projectRoot, ".next", "standalone", ".next", "static");

if (!existsSync(staticSource)) throw new Error("构建后的 .next/static 不存在。");
mkdirSync(resolve(staticTarget, ".."), { recursive: true });
cpSync(staticSource, staticTarget, { recursive: true });
console.log(`已同步 standalone 静态资源：${staticTarget}`);
