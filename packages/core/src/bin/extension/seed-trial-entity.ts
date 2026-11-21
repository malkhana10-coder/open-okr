#!/usr/bin/env node
/**
 * `pnpm ext:seed`: builds the trial entity in the first workspace.
 *
 * For a preview instance somebody looks at, never for a workspace anybody
 * works in: the builder refuses one that already has sectors. The five
 * people share one password. Left out, a random one is made and printed
 * once, because a preview can sit on a public address and a password
 * published in a repository would let anybody approve as leadership.
 */
import { randomBytes } from "node:crypto";
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { createAuth } from "../../auth/auth.ts";
import { passwordProblem } from "../../demo/uat-personas.ts";
import { buildTrialEntity } from "../../extension/trial-entity/builder.ts";
import { OperationError } from "../../operations/errors.ts";

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

function usage(problem: string): never {
  process.stderr.write(`${problem}\n\n`);
  process.stderr.write(
    [
      "Usage: pnpm ext:seed [--password <value>]",
      "",
      "  --password <value>   Shared by the five people. At least 12",
      "                       characters. Left out, one is generated and",
      "                       printed once.",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) {
    return undefined;
  }
  const value = process.argv[at + 1];
  if (!value || value.startsWith("--")) {
    usage(`--${name} needs a value.`);
  }
  return value;
}

const given = flag("password");
if (given) {
  const problem = passwordProblem(given);
  if (problem) {
    usage(problem);
  }
}
const password = given ?? randomBytes(12).toString("base64url");

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

try {
  const { rows } = await pool.query<{
    workspace_id: string;
    user_id: string;
    name: string;
  }>(
    `select w.id as workspace_id, w.name, wm.user_id
       from workspaces w
       join workspace_members wm on wm.workspace_id = w.id
      where w.deleted_at is null
        and wm.deleted_at is null
        and wm.user_id is not null
      order by w.created_at, wm.created_at
      limit 1`,
  );
  const row = rows[0];
  if (!row) {
    process.stderr.write(
      "No workspace found. Open the app and finish the setup wizard first.\n",
    );
    process.exit(1);
  }

  write(`Building the trial entity in "${row.name}".`);
  if (!given) {
    // Before the build, not after: a run that stops halfway has already made
    // the accounts, and a password nobody saw would lock them.
    write(`Password for the five people: ${password}`);
    write("It is not stored anywhere, so keep it.");
  }

  const auth = createAuth({
    pool,
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.BETTER_AUTH_URL,
    rateLimit: { enabled: false },
  });

  const built = await buildTrialEntity({
    pool,
    workspaceId: row.workspace_id,
    adminUserId: row.user_id,
    auth,
    password,
  });

  write(
    `${built.sectors.length} sectors, ${built.agencies} agencies, ${built.domains} domains.`,
  );
  write(
    `${built.objectives} objectives, ${built.indicators} indicators with ${built.readings} readings, ${built.initiatives} initiatives.`,
  );
  write("");
  write("Sign in as any of these:");
  for (const person of built.people) {
    write(`  ${person.email.padEnd(30)} ${person.title}`);
  }
  write("");
  write(given ? "Password: the one you gave." : `Password: ${password}`);
} catch (error) {
  if (error instanceof OperationError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
} finally {
  await pool.end();
}
