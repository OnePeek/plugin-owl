import { fileURLToPath } from "node:url";

/** The repo root, from a compiled test under dist/tests/<dir>/. */
export const repoRoot = (): string => fileURLToPath(new URL("../../../", import.meta.url));
