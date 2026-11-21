/**
 * An objective an agent drafted goes live through its approval request, and
 * no other way (docs/extension/design/b0-vertical-slice.md §13, criterion 9).
 *
 * The product lets the owner of a draft objective publish it. For a draft a
 * person wrote, that is the product's rule and stays as it is. For one an
 * agent drafted, publishing it would put machine-written text live on its
 * owner's word alone, past leadership. `goals.publishDraft` calls this first.
 */
import { activeOnly, goalStrategyProfiles } from "@openokr/db";
import { and, eq, isNotNull } from "drizzle-orm";
import {
  OperationError,
  type OperationTx,
} from "../../operations/operation.ts";

export async function refuseIfHeldForApproval(
  tx: OperationTx,
  workspaceId: string,
  goalId: string,
): Promise<void> {
  const [drafted] = await tx
    .select({ id: goalStrategyProfiles.id })
    .from(goalStrategyProfiles)
    .where(
      activeOnly(
        goalStrategyProfiles,
        and(
          eq(goalStrategyProfiles.workspaceId, workspaceId),
          eq(goalStrategyProfiles.goalId, goalId),
          isNotNull(goalStrategyProfiles.agentRunId),
        ),
      ),
    )
    .limit(1);
  if (drafted) {
    throw new OperationError(
      "conflict",
      "This objective was drafted by an agent and goes live when its approval request is approved.",
    );
  }
}
