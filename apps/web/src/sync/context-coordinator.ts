import type { HouseholdDiscoveryResult } from "./discover-households.js";
import type { ClientIdentity } from "./initialize-client.js";
import type { ResolvedSyncContext } from "./resolve-context.js";
import {
  createSessionGenerationGuard,
  type AuthenticatedOperationHandle,
} from "./session-generation.js";
import {
  createHouseholdSelectionGuard,
  type HouseholdOperationHandle,
  type HouseholdSelectionSnapshot,
} from "./household-selection.js";

export interface SyncContextDependencies {
  discoverHouseholds(signal?: AbortSignal): Promise<HouseholdDiscoveryResult>;
  initializeClient(authSubject: string, signal?: AbortSignal): Promise<ClientIdentity>;
  resolveSyncContext(
    householdId: string, clientId: string, signal?: AbortSignal,
  ): Promise<ResolvedSyncContext>;
}

export type SyncContextStage = "discovery" | "registration" | "context";
export interface SyncContextFailure {
  readonly stage: SyncContextStage;
  readonly code: string | null;
  readonly message: string;
  readonly status: number | null;
  readonly requestId: string | null;
}

type WaitingStatus = "unauthenticated" | "discovering" | "no-households" |
  "selection-required" | "selection-lost" | "registering" | "resolving";
export type SyncContextSnapshot = Readonly<{
  household: HouseholdSelectionSnapshot;
} & (
  | { status: WaitingStatus; context: null; failure: null }
  | { status: "ready"; context: Readonly<ResolvedSyncContext>; failure: null }
  | { status: "failed" | "access-invalidated"; context: null; failure: SyncContextFailure }
)>;

export interface SyncContextCoordinator {
  refresh(): Promise<void>;
  selectHousehold(householdId: string): Promise<boolean>;
  clearSelection(): void;
  invalidate(): void;
  getSnapshot(): SyncContextSnapshot;
}

interface Attempt {
  readonly id: bigint;
  readonly controller: AbortController;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failureDetail(stage: SyncContextStage, error: unknown): SyncContextFailure {
  const source = typeof error === "object" && error !== null ? error : {};
  return Object.freeze({
    stage,
    code: "code" in source && typeof source.code === "string" ? source.code : null,
    message: "message" in source && typeof source.message === "string"
      ? source.message : "The sync context operation failed.",
    status: "status" in source && typeof source.status === "number" ? source.status : null,
    requestId: "requestId" in source && typeof source.requestId === "string"
      ? source.requestId : null,
  });
}

// Explicit, isolated ownership: no adapter value imports, storage, or startup.
export function createSyncContextCoordinator(
  dependencies: SyncContextDependencies,
): SyncContextCoordinator {
  const sessions = createSessionGenerationGuard();
  const households = createHouseholdSelectionGuard(sessions);
  let sequence = 0n;
  let attempt: Attempt | null = null;
  let snapshot: SyncContextSnapshot = Object.freeze({
    status: "unauthenticated", household: households.getSnapshot(), context: null, failure: null,
  });
  let registrationTail: Promise<void> = Promise.resolve();

  // Guard methods may synchronously fire user-supplied abort listeners. Public
  // calls supersede immediately, but their guard mutations wait until the current
  // guard transition finishes. This protects the existing 4.8G transition order.
  let transitioning = false;
  const transitions: Array<() => void> = [];
  function transition<T>(work: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      transitions.push(() => {
        try { resolve(work()); } catch (error) { reject(error); }
      });
      if (transitioning) return;
      transitioning = true;
      try {
        while (transitions.length) transitions.shift()!();
      } finally {
        transitioning = false;
      }
    });
  }

  function current(candidate: Attempt): boolean {
    return attempt === candidate && candidate.id === sequence && !candidate.controller.signal.aborted;
  }

  function replace(status: WaitingStatus): Attempt {
    const previous = attempt;
    const next = { id: ++sequence, controller: new AbortController() };
    attempt = next;
    const household = Object.freeze({
      ...snapshot.household,
      ...(status === "unauthenticated"
        ? { authSubject: null, candidates: null, selectedHouseholdId: null, status: "unauthenticated" as const }
        : {}),
    });
    snapshot = Object.freeze({ status, household, context: null, failure: null });
    previous?.controller.abort();
    return next;
  }

  function publishWaiting(candidate: Attempt, status: WaitingStatus): void {
    if (!current(candidate)) return;
    const household = households.getSnapshot();
    if (!current(candidate)) return;
    snapshot = Object.freeze({ status, household, context: null, failure: null });
  }

  function publishSelection(candidate: Attempt): void {
    if (!current(candidate)) return;
    const household = households.getSnapshot();
    if (!current(candidate)) return;
    const status = household.status;
    // Selected work proceeds to registration; discovery-required is not usable.
    if (status === "selected" || status === "discovery-required" || status === "access-invalidated") return;
    snapshot = Object.freeze({ status, household, context: null, failure: null });
  }

  function eligible(
    candidate: Attempt, session: AuthenticatedOperationHandle, household: HouseholdOperationHandle,
  ): boolean {
    return current(candidate) && sessions.isCurrent(session) && households.isCurrent(household) && current(candidate);
  }

  function fail(candidate: Attempt, stage: SyncContextStage, error: unknown): void {
    if (!current(candidate)) return;
    const failure = failureDetail(stage, error);
    const accessLost = stage === "context" && failure.code === "HOUSEHOLD_ACCESS_DENIED";
    const identityLost = failure.code === "AUTHENTICATION_REQUIRED" ||
      failure.code === "CONTEXT_CORE_USER_MISMATCH";
    const status = accessLost ? "access-invalidated" : "failed";
    // Publish failure before any guard abort can call back into this coordinator.
    const observation = Object.freeze({
      ...snapshot.household,
      ...(identityLost ? { authSubject: null, candidates: null, selectedHouseholdId: null, status: "unauthenticated" as const } : {}),
      ...(accessLost ? { candidates: null, selectedHouseholdId: null, status: "access-invalidated" as const } : {}),
    });
    snapshot = Object.freeze({ status, household: observation, context: null, failure });
    if (identityLost) {
      sessions.invalidate();
      if (!current(candidate)) return;
      households.clearAccount();
    } else if (accessLost) {
      households.invalidateEligibility();
    }
    if (!current(candidate)) return;
    const household = households.getSnapshot();
    if (!current(candidate)) return;
    snapshot = Object.freeze({ status, household, context: null, failure });
  }

  async function prepare(candidate: Attempt): Promise<void> {
    let stage: SyncContextStage = "registration";
    const handles = await transition(() => {
      if (!current(candidate)) return null;
      const session = sessions.beginOperation();
      const household = households.beginOperation();
      const identity = sessions.getCurrentSession();
      if (!session || !household || !identity || !eligible(candidate, session, household)) return null;
      publishWaiting(candidate, "registering");
      return { session, household, authSubject: identity.authSubject };
    });
    if (!handles) return;
    const { session, household, authSubject } = handles;
    const signal = AbortSignal.any([candidate.controller.signal, session.signal, household.signal]);
    try {
      // Reserve the next slot before invoking external code. A cancelled adapter
      // that ignores its signal still owns its slot until its promise settles.
      const registration = registrationTail.then(() => {
        if (!eligible(candidate, session, household)) return null;
        return dependencies.initializeClient(authSubject, signal);
      });
      registrationTail = registration.then(() => undefined, () => undefined);
      const identity = await registration;
      if (!eligible(candidate, session, household) || !identity) return;
      if (identity.authSubject !== authSubject) {
        throw { code: "CLIENT_INIT_OWNERSHIP_MISMATCH", message: "Registration belongs to a different authenticated account." };
      }
      stage = "context";
      await transition(() => {
        if (eligible(candidate, session, household)) publishWaiting(candidate, "resolving");
      });
      if (!eligible(candidate, session, household)) return;
      const context = await dependencies.resolveSyncContext(household.householdId, identity.clientId, signal);
      if (!eligible(candidate, session, household)) return;
      if (typeof context.userId !== "string" || !UUID_PATTERN.test(context.userId) ||
          context.userId.toLowerCase() !== household.coreUserId) {
        throw { code: "CONTEXT_CORE_USER_MISMATCH", message: "Resolved Core user does not match household discovery." };
      }
      // Copy only the adapter contract's scalar fields; retain no source object.
      const detached = Object.freeze({
        requestId: context.requestId, userId: context.userId,
        householdId: context.householdId, membershipId: context.membershipId,
        householdPersonId: context.householdPersonId, clientId: context.clientId,
        locale: context.locale, timeZone: context.timeZone,
      });
      await transition(() => {
        if (!eligible(candidate, session, household)) return;
        const observation = households.getSnapshot();
        if (!eligible(candidate, session, household)) return;
        snapshot = Object.freeze({ status: "ready", household: observation, context: detached, failure: null });
      });
    } catch (error) {
      await transition(() => {
        if (eligible(candidate, session, household)) fail(candidate, stage, error);
      });
    }
  }

  return Object.freeze({
    async refresh() {
      const candidate = replace("discovering");
      try {
        const check = await transition(() => {
          if (!current(candidate)) return null;
          return sessions.beginSessionCheck();
        });
        if (!check || !current(candidate) || check.signal.aborted) return;
        const discovery = await dependencies.discoverHouseholds(check.signal);
        if (!current(candidate) || check.signal.aborted) return;
        const selected = await transition(() => {
          if (!current(candidate) || check.signal.aborted) return false;
          if (discovery.status === "unauthenticated") {
            if (!sessions.acceptUnauthenticatedSession(check) || !current(candidate)) return false;
            households.clearAccount();
            publishWaiting(candidate, "unauthenticated");
            return false;
          }
          if (!sessions.acceptAuthenticatedSession(check, {
            authSubject: discovery.authSubject,
            sessionId: discovery.sessionId,
          }) || !current(candidate) || check.signal.aborted) return false;
          const session = sessions.beginOperation();
          if (!session || !sessions.isCurrent(session) || !current(candidate)) return false;
          if (!households.acceptDiscovery(session, discovery) || !current(candidate) || !sessions.isCurrent(session)) return false;
          const household = households.beginOperation();
          if (!household || !eligible(candidate, session, household)) {
            publishSelection(candidate);
            return false;
          }
          return true;
        });
        if (selected && current(candidate)) await prepare(candidate);
      } catch (error) {
        await transition(() => fail(candidate, "discovery", error));
      }
    },
    async selectHousehold(householdId: string) {
      const observation = snapshot.household;
      if (snapshot.status === "discovering" || snapshot.status === "unauthenticated" || typeof householdId !== "string" ||
          !observation.candidates?.households.some((item) => item.householdId === householdId.toLowerCase())) return false;
      const candidate = replace("registering");
      const accepted = await transition(() => {
        if (!current(candidate)) return false;
        sessions.beginSessionCheck();
        if (!current(candidate)) return false;
        return households.selectHousehold(householdId) && current(candidate);
      });
      if (accepted) await prepare(candidate);
      return accepted;
    },
    clearSelection() {
      const candidate = replace("selection-required");
      void transition(() => {
        if (!current(candidate)) return;
        sessions.beginSessionCheck();
        if (!current(candidate)) return;
        households.clearSelection();
        publishSelection(candidate);
      });
    },
    invalidate() {
      const candidate = replace("unauthenticated");
      void transition(() => {
        if (!current(candidate)) return;
        sessions.invalidate();
        if (!current(candidate)) return;
        households.clearAccount();
        publishWaiting(candidate, "unauthenticated");
      });
    },
    getSnapshot() { return snapshot; },
  });
}
