import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

/**
 * The package imports nothing (docs/extension/design/b0-vertical-slice.md §6.1).
 *
 * The same check runs on the server before a draft is saved and in the browser
 * beside a source panel, the constraint `packages/method` holds. A source file that imported a
 * package, a Node built-in or another workspace would put that into every
 * browser bundle a field is in, and the second caller would no longer be the
 * same rule.
 */

const SOURCE = fileURLToPath(new URL("../src/", import.meta.url));

const IMPORTED =
  /(?:import|export)[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

it("every source file imports only its siblings and zod", async () => {
  const files = (await readdir(SOURCE)).filter((name) => name.endsWith(".ts"));
  expect(files.length).toBeGreaterThan(0);

  const outside: string[] = [];
  for (const name of files) {
    const text = await readFile(join(SOURCE, name), "utf8");
    for (const match of text.matchAll(IMPORTED)) {
      const specifier = match[1] ?? match[2] ?? "";
      if (!specifier.startsWith("./") && specifier !== "zod") {
        outside.push(`${name} imports ${specifier}`);
      }
    }
  }
  expect(outside).toEqual([]);
});
