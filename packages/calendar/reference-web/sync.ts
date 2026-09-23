import {
  CalendarBrowserError,
  fetchCalendarEvent,
  fetchCalendarLayer,
  fetchCalendarSettings,
  submitCalendarMutation,
  type CalendarBrowserMutationInput,
} from "@homi/calendar/client";
import type {
  MutationDeliveryAdapter,
  MutationSubmissionResult,
} from "../../sync/deliver-mutations.js";
import type {
  QueuedMutation,
  LocalCacheApplyAction,
} from "../../sync/local-db.js";
import type {
  SyncChange,
} from "../../sync/sync-feed.js";
import type {
  SyncChangeHandler,
  SyncChangeHandlerContext,
} from "../../sync/reconcile-sync-page.js";

function compareIntegerStrings(left: string, right: string): number {
  const normalize = (value: string) => value.replace(/^0+(?=\d)/, "");
  const a = normalize(left);
  const b = normalize(right);
  return a.length === b.length ? a.localeCompare(b) : a.length - b.length;
}

export const calendarMutationAdapter: MutationDeliveryAdapter =
  Object.freeze({
    moduleKey: "calendar",
    entityType: "event",
    operations: Object.freeze(["create", "update", "delete"]),
    async submit(
      mutation: QueuedMutation,
      clientId: string,
      signal?: AbortSignal,
    ): Promise<MutationSubmissionResult> {
      const input: CalendarBrowserMutationInput = {
        householdId: mutation.householdId,
        clientId,
        clientMutationId: mutation.clientMutationId,
        moduleKey: "calendar",
        entityType: "event",
        entityId: mutation.entityId,
        operation: mutation.operation as
          | "create"
          | "update"
          | "delete",
        baseRevision: mutation.baseRevision,
        payload: mutation.payload,
      };
      return submitCalendarMutation(input, signal);
    },
  });

export const calendarChangeHandler: SyncChangeHandler =
  Object.freeze({
    moduleKey: "calendar",
    entityType: "event",

    async materialize(
      change: SyncChange,
      context: SyncChangeHandlerContext,
      signal?: AbortSignal,
    ): Promise<LocalCacheApplyAction> {
      if (change.operation === "delete") {
        return Object.freeze({
          kind: "delete",
          moduleKey: "calendar",
          entityType: "event",
          entityId: change.entityId,
          sequence: change.sequence,
        });
      }

      if (change.operation !== "create" && change.operation !== "update") {
        throw new CalendarBrowserError(
          "CALENDAR_SYNC_UNSUPPORTED_OPERATION",
          "Calendar received an unsupported change operation.",
        );
      }

      try {
        const event = await fetchCalendarEvent(
          {
            householdId: context.householdId,
            clientId: context.clientId,
            eventId: change.entityId,
          },
          signal,
        );

        if (compareIntegerStrings(event.revision, change.revision) < 0) {
          throw new CalendarBrowserError(
            "CALENDAR_SYNC_STALE_SNAPSHOT",
            "The authoritative Calendar event is older than the sync change.",
          );
        }

        return Object.freeze({
          kind: "put",
          moduleKey: "calendar",
          entityType: "event",
          entityId: change.entityId,
          revision: event.revision,
          sequence: change.sequence,
          data: event,
        });
      } catch (error) {
        // Event identities are never reused. If a historical create/update is
        // followed by a later delete before this client catches up, the current
        // authoritative state is absence. Materializing that earlier change as
        // a delete is safe and lets the ordered feed continue to the delete row.
        if (
          error instanceof CalendarBrowserError &&
          error.code === "CALENDAR_EVENT_NOT_FOUND"
        ) {
          return Object.freeze({
            kind: "delete",
            moduleKey: "calendar",
            entityType: "event",
            entityId: change.entityId,
            sequence: change.sequence,
          });
        }
        throw error;
      }
    },
  });

export const calendarSettingsChangeHandler: SyncChangeHandler =
  Object.freeze({
    moduleKey: "calendar",
    entityType: "settings",

    async materialize(
      change: SyncChange,
      context: SyncChangeHandlerContext,
      signal?: AbortSignal,
    ): Promise<LocalCacheApplyAction> {
      if (
        change.entityId.toLowerCase() !== context.householdId.toLowerCase() ||
        (change.operation !== "create" && change.operation !== "update")
      ) {
        throw new CalendarBrowserError(
          "CALENDAR_SETTINGS_SYNC_INVALID_CHANGE",
          "Calendar settings received an invalid sync change.",
        );
      }

      const settings = await fetchCalendarSettings(
        {
          householdId: context.householdId,
          clientId: context.clientId,
        },
        signal,
      );
      if (compareIntegerStrings(settings.revision, change.revision) < 0) {
        throw new CalendarBrowserError(
          "CALENDAR_SETTINGS_SYNC_STALE_SNAPSHOT",
          "The authoritative Calendar settings are older than the sync change.",
        );
      }

      return Object.freeze({
        kind: "put",
        moduleKey: "calendar",
        entityType: "settings",
        entityId: context.householdId,
        revision: settings.revision,
        sequence: change.sequence,
        data: settings,
      });
    },
  });

export const calendarLayerChangeHandler: SyncChangeHandler =
  Object.freeze({
    moduleKey: "calendar",
    entityType: "calendar",

    async materialize(
      change: SyncChange,
      context: SyncChangeHandlerContext,
      signal?: AbortSignal,
    ): Promise<LocalCacheApplyAction> {
      if (change.operation === "delete") {
        return Object.freeze({
          kind: "delete",
          moduleKey: "calendar",
          entityType: "calendar",
          entityId: change.entityId,
          sequence: change.sequence,
        });
      }
      if (change.operation !== "create" && change.operation !== "update") {
        throw new CalendarBrowserError(
          "CALENDAR_LAYER_SYNC_UNSUPPORTED_OPERATION",
          "Calendar layer received an unsupported change operation.",
        );
      }
      try {
        const layer = await fetchCalendarLayer(
          {
            householdId: context.householdId,
            clientId: context.clientId,
            calendarId: change.entityId,
          },
          signal,
        );
        if (compareIntegerStrings(layer.revision, change.revision) < 0) {
          throw new CalendarBrowserError(
            "CALENDAR_LAYER_SYNC_STALE_SNAPSHOT",
            "The authoritative Calendar layer is older than the sync change.",
          );
        }
        return Object.freeze({
          kind: "put",
          moduleKey: "calendar",
          entityType: "calendar",
          entityId: change.entityId,
          revision: layer.revision,
          sequence: change.sequence,
          data: layer,
        });
      } catch (error) {
        if (
          error instanceof CalendarBrowserError &&
          error.code === "CALENDAR_LAYER_NOT_FOUND"
        ) {
          return Object.freeze({
            kind: "delete",
            moduleKey: "calendar",
            entityType: "calendar",
            entityId: change.entityId,
            sequence: change.sequence,
          });
        }
        throw error;
      }
    },
  });
