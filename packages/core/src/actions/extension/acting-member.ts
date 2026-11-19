/**
 * The member a call is made as, for the planning extension's actions.
 *
 * The same resolution the shipped actions each carry a copy of: an active
 * member of this workspace behind this user, or not-found, so a caller learns
 * nothing about a workspace they are not in.
 */
import { activeOnly, workspaceMembers } from "@openokr/db";
import { eq } from "drizzle-orm";
import {
  OperationError,
  type OperationTx,
} from "../../operations/operation.ts";

export async function actingMemberId(
  tx: OperationTx,
  workspaceId: string,
  userId: string | undefined,
): Promise<string> {
  if (!userId) {
    throw new OperationError("not_found", "No such workspace.");
  }
  const [member] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  if (!member) {
    throw new OperationError("not_found", "No such workspace.");
  }
  return member.id;
}
