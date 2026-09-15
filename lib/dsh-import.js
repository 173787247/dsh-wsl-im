/**
 * Resolve @deepseek-ai/* packages from the dsh install / profile fallback.
 * Bare `import` fails when this plugin is `link:`'d from outside the profile tree
 * (e.g. /mnt/c/... on WSL).
 */

import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

function candidateRoots() {
  const home = homedir();
  return [
    path.join(home, ".dsh", "profiles", "node_modules"),
    path.join(home, ".dsh", "profiles", "web", "node_modules"),
    path.join(home, ".local", "lib", "node_modules", "@deepseek-ai", "dsh", "node_modules"),
    path.join(home, ".local", "lib", "node_modules"),
  ];
}

export async function importDsh(specifier) {
  try {
    return await import(specifier);
  } catch {
    /* fall through */
  }
  let lastErr;
  for (const root of candidateRoots()) {
    try {
      const resolved = require.resolve(specifier, { paths: [root] });
      return await import(pathToFileURL(resolved).href);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Cannot resolve ${specifier} (link:/external plugin). Last: ${lastErr?.message || lastErr}`,
  );
}
