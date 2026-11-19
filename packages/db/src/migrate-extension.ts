/**
 * The extension's own migration stream
 * (docs/extension/design/b0-vertical-slice.md §6 row 2).
 *
 * The planning extension's tables live beside the shipped schema, not inside
 * its numbering. The runner refuses a new file that sorts before the last
 * applied one, so one shared ledger would make either side's next migration
 * out of order for the other. This stream has its own directory and its own
 * ledger, and runs after the shipped stream, because its tables reference
 * shipped ones and never the other way round.
 */
import { join } from "node:path";
import {
  type MigrationClient,
  type RunMigrationsOptions,
  runMigrations,
} from "./migrate.ts";

export const EXTENSION_LEDGER = "_migrations_ext";

export const EXTENSION_MIGRATIONS_DIR = join(
  import.meta.dirname,
  "../migrations-ext",
);

/**
 * Applies the extension stream. Call it after `runMigrations` on the same
 * connection. A directory that does not exist applies nothing.
 */
export function runExtensionMigrations(
  client: MigrationClient,
  options: Pick<RunMigrationsOptions, "dataChanges" | "log"> & {
    readonly dir?: string;
  } = {},
): Promise<string[]> {
  return runMigrations(client, {
    dirs: [options.dir ?? EXTENSION_MIGRATIONS_DIR],
    ledger: EXTENSION_LEDGER,
    ...(options.dataChanges ? { dataChanges: options.dataChanges } : {}),
    ...(options.log ? { log: options.log } : {}),
  });
}
