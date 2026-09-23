import type {
  MutationDeliveryAdapter,
  MutationSubmissionResult,
} from "./deliver-mutations.js";
import type { QueuedMutation } from "./local-db.js";
import {
  submitMutation,
  type SubmitMutationInput,
} from "./submit-mutation.js";

function requestFor(
  mutation: QueuedMutation,
  clientId: string,
): SubmitMutationInput {
  return {
    householdId: mutation.householdId,
    clientId,
    clientMutationId: mutation.clientMutationId,
    moduleKey: "core",
    entityType: "household",
    entityId: mutation.entityId,
    operation: "update",
    baseRevision: mutation.baseRevision,
    payload: mutation.payload as SubmitMutationInput["payload"],
  };
}

export const coreHouseholdMutationAdapter: MutationDeliveryAdapter =
  Object.freeze({
    moduleKey: "core",
    entityType: "household",
    operations: Object.freeze(["update"]),
    async submit(
      mutation: QueuedMutation,
      clientId: string,
      signal?: AbortSignal,
    ): Promise<MutationSubmissionResult> {
      return submitMutation(
        requestFor(mutation, clientId),
        signal,
      );
    },
  });
