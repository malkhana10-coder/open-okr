import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workerDb } from "@openokr/test-support/db";
import pg from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EXTENSION_LEDGER,
  runExtensionMigrations,
} from "../../src/extension/migrate.ts";
import { runMigrations } from "../../src/migrate.ts";

/**
 * A second, independent stream of migrations with its own ledger
 * (docs/extension/design/b0-vertical-slice.md §6 row 2).
 *
 * The runner refuses a new file that sorts before the last applied one. With
 * one ledger, an extension migration numbered above the shipped ones would
 * make every later upstream migration out of order. Two ledgers keep the two
 * histories forward-only without either knowing the other's numbering.
 */

let core: string;
let extension: string;
let scratchDb: string;
let client: pg.Client;

beforeEach(async () => {
  core = await mkdtemp(join(tmpdir(), "openokr-ledger-core-"));
  extension = await mkdtemp(join(tmpdir(), "openokr-ledger-ext-"));
  const wb = await workerDb();
  scratchDb = `${wb.databaseName}_ledger`;
  await wb.admin.query(`drop database if exists ${scratchDb} with (force)`);
  await wb.admin.query(
    `create database ${scratchDb} ` +
      `encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`,
  );
  const admin = wb.admin.options;
  client = new pg.Client({
    host: admin.host,
    port: admin.port,
    user: admin.user,
    password: admin.password as string,
    database: scratchDb,
  });
  await client.connect();
});

afterEach(async () => {
  await client.end();
  await rm(core, { recursive: true, force: true });
  await rm(extension, { recursive: true, force: true });
  const wb = await workerDb();
  await wb.admin.query(`drop database if exists ${scratchDb} with (force)`);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

const names = async (table: string): Promise<string[]> => {
  const { rows } = await client.query(
    `select name from ${table} order by name`,
  );
  return rows.map((row) => row.name as string);
};

describe("a second migration ledger", () => {
  it("records a stream in the ledger it names and leaves the default alone", async () => {
    await writeFile(join(core, "0001_core.sql"), "create table one (id int);");
    await writeFile(
      join(extension, "0001_ext.sql"),
      "create table ext_one (id int);",
    );

    await runMigrations(client, { dirs: [core] });
    const applied = await runMigrations(client, {
      dirs: [extension],
      ledger: "_migrations_ext",
    });

    expect(applied).toEqual(["0001_ext.sql"]);
    expect(await names("_migrations")).toEqual(["0001_core.sql"]);
    expect(await names("_migrations_ext")).toEqual(["0001_ext.sql"]);
  });

  it("lets a later core migration run after extension migrations exist", async () => {
    await writeFile(join(core, "0001_core.sql"), "create table one (id int);");
    await writeFile(
      join(extension, "0900_ext.sql"),
      "create table ext_one (id int);",
    );
    await runMigrations(client, { dirs: [core] });
    await runMigrations(client, {
      dirs: [extension],
      ledger: "_migrations_ext",
    });

    // The upstream project ships its next migration. In one ledger this
    // would sort before 0900_ext.sql and be refused.
    await writeFile(join(core, "0002_core.sql"), "create table two (id int);");
    expect(await runMigrations(client, { dirs: [core] })).toEqual([
      "0002_core.sql",
    ]);
  });

  it("still refuses an out-of-order file inside its own ledger", async () => {
    await writeFile(
      join(extension, "0002_ext.sql"),
      "create table ext_two (id int);",
    );
    await runMigrations(client, {
      dirs: [extension],
      ledger: "_migrations_ext",
    });
    await writeFile(
      join(extension, "0001_ext.sql"),
      "create table ext_one (id int);",
    );

    await expect(
      runMigrations(client, { dirs: [extension], ledger: "_migrations_ext" }),
    ).rejects.toThrow(/sorts before already applied/);
    // Refused by its own history, which the default ledger never saw.
    expect(await names("_migrations_ext")).toEqual(["0002_ext.sql"]);
    await expect(names("_migrations")).rejects.toThrow(/does not exist/);
  });

  it("refuses a ledger name that is not a plain identifier", async () => {
    await expect(
      runMigrations(client, {
        dirs: [extension],
        ledger: "_migrations; drop table x",
      }),
    ).rejects.toThrow(/ledger/i);
  });
});

describe("runExtensionMigrations", () => {
  it("applies a directory into the extension ledger", async () => {
    await writeFile(
      join(extension, "0001_ext.sql"),
      "create table ext_one (id int);",
    );

    const applied = await runExtensionMigrations(client, { dir: extension });

    expect(applied).toEqual(["0001_ext.sql"]);
    expect(await names(EXTENSION_LEDGER)).toEqual(["0001_ext.sql"]);
  });

  it("applies nothing when the directory does not exist", async () => {
    const applied = await runExtensionMigrations(client, {
      dir: join(extension, "absent"),
    });
    expect(applied).toEqual([]);
    // The stream ran against its own ledger, which now exists and is empty.
    expect(await names(EXTENSION_LEDGER)).toEqual([]);
  });
});

describe("the extension migrations directory", () => {
  /**
   * `@openokr/db` is bundled into the web application, where
   * `import.meta.dirname` is undefined. A path joined when the module loads
   * threw there and failed the build, so the path is worked out when it is
   * asked for, which only the migrator and the test harness do.
   */
  it("is worked out when asked for, not when the module loads", async () => {
    const module = await import("../../src/extension/migrate.ts");
    expect("EXTENSION_MIGRATIONS_DIR" in module).toBe(false);
    expect(module.extensionMigrationsDir()).toMatch(
      /packages[\\/]db[\\/]migrations-ext$/,
    );
  });

  it("joins no path at the top level of the module", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      join(import.meta.dirname, "../../src/extension/migrate.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/^export const \w+ = join\(/m);
  });
});
