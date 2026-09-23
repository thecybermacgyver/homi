import type { ComponentType } from "react";
import {
  HOMI_MODULE_API_VERSION,
} from "./version.js";
import type { HomiRequestContext } from "./request-context.js";

export type HomiModuleSetupState = "configured" | "unconfigured";

export interface HomiModuleSetupStatus {
  readonly state: HomiModuleSetupState;
}

export interface HomiModuleDatabaseQueryResult<
  Row extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly rows: readonly Row[];
  readonly rowCount: number;
}

export interface HomiModuleDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<HomiModuleDatabaseQueryResult<Row>>;

  transaction<T>(
    work: (database: HomiModuleDatabase) => Promise<T>,
  ): Promise<T>;
}

export interface HomiHouseholdPerson {
  readonly id: string;
  readonly displayName: string;
  readonly avatarFileId: string | null;
}

export interface HomiHouseholdPeopleCapability {
  listActive(
    context: HomiRequestContext,
  ): Promise<readonly HomiHouseholdPerson[]>;
}

export interface HomiModuleSyncPublishInput {
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: "create" | "update" | "delete";
  readonly revision: string;
  readonly serverState?: unknown;
  readonly recipientUserId?: string;
}

export interface HomiModuleSyncPublisherCapability {
  publish(
    context: HomiRequestContext,
    input: HomiModuleSyncPublishInput,
  ): Promise<string>;
}

export interface HomiModuleSecretsCapability {
  get(
    context: HomiRequestContext,
    key: string,
  ): Promise<string | null>;
  set(
    context: HomiRequestContext,
    key: string,
    value: string,
  ): Promise<void>;
  delete(
    context: HomiRequestContext,
    key: string,
  ): Promise<void>;
}

export interface HomiModuleJobScheduleInput {
  readonly jobType: string;
  readonly runAt: string;
  readonly payload: Record<string, unknown>;
  readonly dedupeKey?: string;
}

export interface HomiModuleJobsCapability {
  schedule(
    context: HomiRequestContext,
    input: HomiModuleJobScheduleInput,
  ): Promise<string>;
  cancelByDedupeKey(
    context: HomiRequestContext,
    dedupeKey: string,
  ): Promise<number>;
}

export interface HomiModuleNotificationInput {
  readonly personIds?: readonly string[];
  readonly notificationType: string;
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly expiresAt?: string | null;
}

export interface HomiModuleNotificationsCapability {
  notify(
    context: HomiRequestContext,
    input: HomiModuleNotificationInput,
  ): Promise<readonly string[]>;
}


export interface HomiModuleAtomicServices {
  readonly database: HomiModuleDatabase;
  readonly sync?: HomiModuleSyncPublisherCapability;
  readonly secrets?: HomiModuleSecretsCapability;
  readonly jobs?: HomiModuleJobsCapability;
  readonly notifications?: HomiModuleNotificationsCapability;
}

export interface HomiModuleAtomicCapability {
  run<T>(
    context: HomiRequestContext,
    work: (services: HomiModuleAtomicServices) => Promise<T>,
  ): Promise<T>;
}

export interface HomiModuleJobHandler {
  readonly jobType: string;
  handle(
    context: HomiRequestContext,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void>;
}

export interface HomiBrokerInvocation {
  readonly action: string;
  readonly payload: unknown;
}

export interface HomiServerBrokerProvider {
  readonly capability: string;
  handle(
    context: HomiRequestContext,
    invocation: HomiBrokerInvocation,
  ): Promise<unknown>;
}

export type HomiBrokerCapabilityState =
  | "available"
  | "not-installed"
  | "not-enabled";

export interface HomiBrokerCapabilityStatus {
  readonly capability: string;
  readonly state: HomiBrokerCapabilityState;
  readonly providerModuleKey: string | null;
  readonly available: boolean;
}

export interface HomiModuleBrokerClient {
  status(
    context: HomiRequestContext,
    capability: string,
  ): Promise<HomiBrokerCapabilityStatus>;
  invoke(
    context: HomiRequestContext,
    capability: string,
    invocation: HomiBrokerInvocation,
  ): Promise<unknown>;
}

export interface HomiServerModuleHostContext {
  readonly moduleDatabase: HomiModuleDatabase;
  readonly householdPeople?: HomiHouseholdPeopleCapability;
  readonly sync?: HomiModuleSyncPublisherCapability;
  readonly secrets?: HomiModuleSecretsCapability;
  readonly jobs?: HomiModuleJobsCapability;
  readonly notifications?: HomiModuleNotificationsCapability;
  readonly atomic?: HomiModuleAtomicCapability;
  readonly broker?: HomiModuleBrokerClient;

  resolveContext(request: {
    id: string;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<HomiRequestContext>;

  requireEnabled(
    moduleKey: string,
    context: HomiRequestContext,
  ): Promise<void>;
}

export interface HomiModuleServerMutationInput {
  readonly entityId: string;
  readonly operation: string;
  readonly baseRevision: string;
  readonly payload: Record<string, unknown>;
}

export type HomiModuleServerMutationResult =
  | {
      readonly status: "applied";
      readonly revision: string;
      readonly serverState: unknown;
    }
  | {
      readonly status: "conflict";
      readonly revision: string;
      readonly errorCode?: string;
      readonly serverState: unknown;
    }
  | {
      readonly status: "rejected";
      readonly revision: string | null;
      readonly errorCode: string;
      readonly serverState: unknown;
    };

export interface HomiModuleMutationServices {
  readonly secrets?: HomiModuleSecretsCapability;
  readonly jobs?: HomiModuleJobsCapability;
  readonly notifications?: HomiModuleNotificationsCapability;
}

export interface HomiModuleServerMutationHandler {
  readonly entityType: string;
  readonly operations: readonly string[];
  apply(
    context: HomiRequestContext,
    database: HomiModuleDatabase,
    input: HomiModuleServerMutationInput,
    services: HomiModuleMutationServices,
  ): Promise<HomiModuleServerMutationResult>;
}

export interface HomiServerModuleSyncContributions {
  readonly mutationHandlers:
    readonly HomiModuleServerMutationHandler[];
}

export interface HomiServerModuleJobContributions {
  readonly handlers: readonly HomiModuleJobHandler[];
}

export interface HomiServerModuleBrokerContributions {
  readonly providers: readonly HomiServerBrokerProvider[];
}

export interface HomiServerModuleDefinition {
  readonly moduleKey: string;
  readonly moduleApiVersion: typeof HOMI_MODULE_API_VERSION;
  readonly sync?: HomiServerModuleSyncContributions;
  readonly jobs?: HomiServerModuleJobContributions;
  readonly broker?: HomiServerModuleBrokerContributions;
  getSetupStatus?(
    context: HomiRequestContext,
  ):
    | HomiModuleSetupStatus
    | Promise<HomiModuleSetupStatus>;
}

export interface HomiWebModuleHostContext {
  readonly authSubject: string;
  readonly householdId: string;
  readonly clientId: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly online: boolean;
}

export interface HomiWebModuleMutationInput {
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: string;
  readonly baseRevision: string;
  readonly payload: Record<string, unknown>;
}

export interface HomiWebModuleQueuedMutationReceipt {
  readonly clientMutationId: string;
}

export interface HomiWebModuleCachedEntity {
  readonly entityType: string;
  readonly entityId: string;
  readonly revision: string;
  readonly sequence: string;
  readonly data: unknown;
}

export interface HomiWebModuleSnapshotEntity {
  readonly entityId: string;
  readonly revision: string;
  readonly data: unknown;
}

export interface HomiWebModuleContextAction {
  readonly label: string;
  readonly available?: boolean;
  invoke(): void;
}

export interface HomiWebModuleContextActions {
  readonly search?: HomiWebModuleContextAction;
  readonly create?: HomiWebModuleContextAction;
}

export interface HomiWebModuleHostActions {
  registerContextActions(
    actions: HomiWebModuleContextActions | null,
  ): void;
  refreshModuleState(): Promise<void>;
  syncNow(): Promise<void>;
  navigate(path: string): void;
  enqueueMutation(
    input: HomiWebModuleMutationInput,
  ): Promise<HomiWebModuleQueuedMutationReceipt>;
  getCachedEntity(
    entityType: string,
    entityId: string,
  ): Promise<HomiWebModuleCachedEntity | null>;
  listCachedEntities(
    entityType: string,
  ): Promise<readonly HomiWebModuleCachedEntity[]>;
  replaceCachedEntities(
    entityType: string,
    entities: readonly HomiWebModuleSnapshotEntity[],
  ): Promise<void>;
}

export interface HomiWebModuleSurfaceProps {
  readonly context: HomiWebModuleHostContext;
  readonly actions: HomiWebModuleHostActions;
}

export type HomiWebModuleSurface =
  ComponentType<HomiWebModuleSurfaceProps>;

export interface HomiModuleQueuedMutation {
  readonly clientMutationId: string;
  readonly householdId: string;
  readonly moduleKey: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: string;
  readonly baseRevision: string;
  readonly payload: Record<string, unknown>;
}

export interface HomiModuleMutationSubmissionResult {
  readonly clientMutationId: string;
  readonly status: "received" | "applied" | "conflict" | "rejected";
  readonly serverRevision: string | null;
  readonly changeSequence: string | null;
  readonly errorCode: string | null;
  readonly serverState: unknown;
  readonly replayed: boolean;
}

export interface HomiModuleMutationAdapter {
  readonly moduleKey: string;
  readonly entityType: string;
  readonly operations: readonly string[];
  submit(
    mutation: HomiModuleQueuedMutation,
    clientId: string,
    signal?: AbortSignal,
  ): Promise<HomiModuleMutationSubmissionResult>;
}

export interface HomiModuleSyncChange {
  readonly sequence: string;
  readonly householdId: string;
  readonly moduleKey: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: string;
  readonly revision: string;
  readonly changedByUserId: string | null;
  readonly clientId: string | null;
  readonly changedAt: string;
}

export interface HomiModuleCacheIdentity {
  readonly moduleKey: string;
  readonly entityType: string;
  readonly entityId: string;
}

export type HomiModuleCacheApplyAction =
  | (HomiModuleCacheIdentity & {
      readonly kind: "put";
      readonly revision: string;
      readonly sequence: string;
      readonly data: unknown;
    })
  | (HomiModuleCacheIdentity & {
      readonly kind: "delete";
      readonly sequence: string;
    });

export interface HomiModuleSyncHandlerContext {
  readonly householdId: string;
  readonly clientId: string;
}

export interface HomiModuleSyncChangeHandler {
  readonly moduleKey: string;
  readonly entityType: string;
  materialize(
    change: HomiModuleSyncChange,
    context: HomiModuleSyncHandlerContext,
    signal?: AbortSignal,
  ): Promise<HomiModuleCacheApplyAction>;
}

export interface HomiWebModuleSyncContributions {
  readonly mutationAdapters: readonly HomiModuleMutationAdapter[];
  readonly changeHandlers: readonly HomiModuleSyncChangeHandler[];
}

export interface HomiWebModuleSettingsSurfaces {
  readonly household?: HomiWebModuleSurface;
  readonly user?: HomiWebModuleSurface;
}

export interface HomiWebModuleDefinition {
  readonly moduleKey: string;
  readonly moduleApiVersion: typeof HOMI_MODULE_API_VERSION;
  readonly pages: Readonly<Record<string, HomiWebModuleSurface>>;
  readonly setup?: HomiWebModuleSurface;
  readonly settings?: HomiWebModuleSettingsSurfaces;
  readonly familyBoard?: Readonly<
    Record<string, HomiWebModuleSurface>
  >;
  readonly sync: HomiWebModuleSyncContributions;
}

function validModuleKey(value: string): boolean {
  return /^[a-z][a-z0-9-]{1,63}$/.test(value);
}

function validIdentifier(value: string): boolean {
  return /^[a-z][a-z0-9-]{0,63}$/.test(value);
}

function validCapability(value: string): boolean {
  return /^[a-z][a-z0-9.-]{1,127}$/.test(value);
}

function validateSurfaces(
  surfaces: Readonly<Record<string, HomiWebModuleSurface>>,
): Readonly<Record<string, HomiWebModuleSurface>> {
  const result: Record<string, HomiWebModuleSurface> = {};
  for (const [id, surface] of Object.entries(surfaces)) {
    if (!validIdentifier(id)) {
      throw new Error("Homi web module pages contain an invalid page ID.");
    }
    if (typeof surface !== "function") {
      throw new Error(
        `Homi web module page '${id}' must be a component function.`,
      );
    }
    result[id] = surface;
  }
  return Object.freeze(result);
}

function validateMutationAdapters(
  adapters: readonly HomiModuleMutationAdapter[],
): readonly HomiModuleMutationAdapter[] {
  const tuples = new Set<string>();
  for (const adapter of adapters) {
    if (
      !validModuleKey(adapter.moduleKey) ||
      !validIdentifier(adapter.entityType) ||
      adapter.operations.length === 0 ||
      adapter.operations.some((operation) => !validIdentifier(operation)) ||
      typeof adapter.submit !== "function"
    ) {
      throw new Error("Homi web module contains an invalid mutation adapter.");
    }
    for (const operation of adapter.operations) {
      const key = JSON.stringify([
        adapter.moduleKey,
        adapter.entityType,
        operation,
      ]);
      if (tuples.has(key)) {
        throw new Error(
          "Homi web module contains duplicate mutation adapter ownership.",
        );
      }
      tuples.add(key);
    }
  }
  return Object.freeze([...adapters]);
}

function validateChangeHandlers(
  handlers: readonly HomiModuleSyncChangeHandler[],
): readonly HomiModuleSyncChangeHandler[] {
  const tuples = new Set<string>();
  for (const handler of handlers) {
    if (
      !validModuleKey(handler.moduleKey) ||
      !validIdentifier(handler.entityType) ||
      typeof handler.materialize !== "function"
    ) {
      throw new Error("Homi web module contains an invalid change handler.");
    }
    const key = JSON.stringify([
      handler.moduleKey,
      handler.entityType,
    ]);
    if (tuples.has(key)) {
      throw new Error(
        "Homi web module contains duplicate change-handler ownership.",
      );
    }
    tuples.add(key);
  }
  return Object.freeze([...handlers]);
}

export function defineHomiServerModule<
  T extends HomiServerModuleDefinition,
>(definition: T): Readonly<T> {
  if (!validModuleKey(definition.moduleKey)) {
    throw new Error("Homi server module has an invalid moduleKey.");
  }
  if (definition.moduleApiVersion !== HOMI_MODULE_API_VERSION) {
    throw new Error(
      `Unsupported Homi module API version ${definition.moduleApiVersion}.`,
    );
  }
  if (
    definition.getSetupStatus !== undefined &&
    typeof definition.getSetupStatus !== "function"
  ) {
    throw new Error(
      "Homi server module getSetupStatus must be a function.",
    );
  }

  if (definition.sync) {
    const owners = new Set<string>();
    for (const handler of definition.sync.mutationHandlers) {
      if (
        !validIdentifier(handler.entityType) ||
        handler.operations.length === 0 ||
        handler.operations.some(
          (operation) => !validIdentifier(operation),
        ) ||
        typeof handler.apply !== "function"
      ) {
        throw new Error(
          "Homi server module contains an invalid mutation handler.",
        );
      }

      for (const operation of handler.operations) {
        const key = JSON.stringify([
          handler.entityType,
          operation,
        ]);
        if (owners.has(key)) {
          throw new Error(
            "Homi server module contains duplicate mutation-handler ownership.",
          );
        }
        owners.add(key);
      }
    }
  }

  if (definition.broker) {
    const capabilities = new Set<string>();
    for (const provider of definition.broker.providers) {
      if (
        !validCapability(provider.capability) ||
        typeof provider.handle !== "function"
      ) {
        throw new Error(
          "Homi server module contains an invalid broker provider.",
        );
      }
      if (capabilities.has(provider.capability)) {
        throw new Error(
          "Homi server module contains duplicate broker provider ownership.",
        );
      }
      capabilities.add(provider.capability);
    }
  }

  if (definition.jobs) {
    const jobTypes = new Set<string>();
    for (const handler of definition.jobs.handlers) {
      if (
        !validIdentifier(handler.jobType) ||
        typeof handler.handle !== "function" ||
        jobTypes.has(handler.jobType)
      ) {
        throw new Error(
          "Homi server module contains an invalid or duplicate job handler.",
        );
      }
      jobTypes.add(handler.jobType);
    }
  }

  return Object.freeze(definition);
}

export function defineHomiWebModule<
  T extends HomiWebModuleDefinition,
>(definition: T): Readonly<T> {
  if (!validModuleKey(definition.moduleKey)) {
    throw new Error("Homi web module has an invalid moduleKey.");
  }
  if (definition.moduleApiVersion !== HOMI_MODULE_API_VERSION) {
    throw new Error(
      `Unsupported Homi module API version ${definition.moduleApiVersion}.`,
    );
  }

  const pages = validateSurfaces(definition.pages);

  if (
    definition.setup !== undefined &&
    typeof definition.setup !== "function"
  ) {
    throw new Error("Homi web module setup must be a component function.");
  }

  if (definition.settings) {
    if (
      definition.settings.household !== undefined &&
      typeof definition.settings.household !== "function"
    ) {
      throw new Error(
        "Homi web module household settings must be a component function.",
      );
    }
    if (
      definition.settings.user !== undefined &&
      typeof definition.settings.user !== "function"
    ) {
      throw new Error(
        "Homi web module user settings must be a component function.",
      );
    }
  }

  const familyBoard =
    definition.familyBoard === undefined
      ? undefined
      : validateSurfaces(definition.familyBoard);

  const mutationAdapters = validateMutationAdapters(
    definition.sync?.mutationAdapters ?? [],
  );
  const changeHandlers = validateChangeHandlers(
    definition.sync?.changeHandlers ?? [],
  );

  return Object.freeze({
    ...definition,
    pages,
    ...(familyBoard === undefined
      ? {}
      : { familyBoard }),
    ...(definition.sync === undefined
      ? {}
      : {
          sync: Object.freeze({
            mutationAdapters,
            changeHandlers,
          }),
        }),
  });
}
