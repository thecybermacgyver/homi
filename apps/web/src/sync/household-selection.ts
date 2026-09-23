import type {
  AuthenticatedOperationHandle,
  SessionGenerationGuard,
} from "./session-generation.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOUSEHOLD_OPERATION_BRAND = Symbol("HouseholdOperationHandle");

export interface HouseholdCandidate {
  readonly householdId: string;
  readonly name: string;
}

export interface HouseholdDiscoveryInput {
  readonly coreUserId: string;
  readonly households: readonly HouseholdCandidate[];
}

export type HouseholdSelectionStatus =
  | "unauthenticated"
  | "discovery-required"
  | "no-households"
  | "selection-required"
  | "selection-lost"
  | "access-invalidated"
  | "selected";

export interface HouseholdSelectionSnapshot {
  readonly authSubject: string | null;
  readonly status: HouseholdSelectionStatus;
  readonly candidates: HouseholdDiscoveryInput | null;
  readonly selectedHouseholdId: string | null;
  readonly revision: bigint;
}

export interface HouseholdOperationHandle {
  readonly [HOUSEHOLD_OPERATION_BRAND]: true;
  readonly householdId: string;
  readonly coreUserId: string;
  readonly signal: AbortSignal;
  readonly revision: bigint;
}

export interface HouseholdSelectionGuard {
  acceptDiscovery(
    operation: AuthenticatedOperationHandle,
    input: HouseholdDiscoveryInput,
  ): boolean;
  selectHousehold(householdId: string): boolean;
  getSnapshot(): HouseholdSelectionSnapshot;
  beginOperation(): HouseholdOperationHandle | null;
  isCurrent(handle: HouseholdOperationHandle): boolean;
  clearSelection(): void;
  invalidateEligibility(): void;
  clearAccount(): void;
}

export class HouseholdSelectionError extends Error {
  readonly code = "HOUSEHOLD_SELECTION_INVALID_DISCOVERY";

  constructor() {
    super("Discovery requires a Core user UUID and unique household UUIDs with non-empty names.");
    this.name = "HouseholdSelectionError";
  }
}

function copyDiscovery(input: HouseholdDiscoveryInput): HouseholdDiscoveryInput {
  if (
    !input ||
    typeof input.coreUserId !== "string" ||
    !UUID_PATTERN.test(input.coreUserId) ||
    !Array.isArray(input.households)
  ) {
    throw new HouseholdSelectionError();
  }
  const seen = new Set<string>();
  const households: HouseholdCandidate[] = [];
  for (const candidate of input.households) {
    if (
      !candidate ||
      typeof candidate.householdId !== "string" ||
      !UUID_PATTERN.test(candidate.householdId) ||
      typeof candidate.name !== "string" ||
      candidate.name.trim().length === 0 ||
      seen.has(candidate.householdId.toLowerCase())
    ) {
      throw new HouseholdSelectionError();
    }
    seen.add(candidate.householdId.toLowerCase());
    households.push(Object.freeze({
      householdId: candidate.householdId.toLowerCase(),
      name: candidate.name,
    }));
  }
  return Object.freeze({
    coreUserId: input.coreUserId.toLowerCase(),
    households: Object.freeze(households),
  });
}

// Explicit in-memory composition only. Snapshots are observations, not authority;
// callers must use isCurrent() before adopting asynchronous household results.
export function createHouseholdSelectionGuard(
  sessions: SessionGenerationGuard,
): HouseholdSelectionGuard {
  let owner: string | null = null;
  let generation = sessions.getGeneration();
  let sessionOperation: AuthenticatedOperationHandle | null = null;
  let candidates: HouseholdDiscoveryInput | null = null;
  let preferred: string | null = null;
  let selected: string | null = null;
  let revision = 0n;
  let controller: AbortController | null = null;
  let status: HouseholdSelectionStatus = "unauthenticated";
  let requiresExplicitSelection = false;
  const issued = new WeakMap<HouseholdOperationHandle, {
    session: AuthenticatedOperationHandle;
    controller: AbortController;
  }>();

  function dropSelection(): void {
    const previous = controller;
    controller = null;
    selected = null;
    revision += 1n;
    previous?.abort();
  }

  function resetAccount(): void {
    sessionOperation = null;
    candidates = null;
    preferred = null;
    requiresExplicitSelection = false;
    owner = null;
    status = "unauthenticated";
    dropSelection();
  }

  function reconcileSession(): void {
    const identity = sessions.getCurrentSession();
    const nextGeneration = sessions.getGeneration();
    // The existing guard aborts before publishing its next identity. During that
    // callback, beginOperation() is null even though getCurrentSession() is old.
    const current = sessions.beginOperation();
    if (!current) {
      if (!identity && (owner !== null || sessionOperation !== null)) resetAccount();
      return;
    }
    if (
      owner !== identity?.authSubject ||
      nextGeneration - generation > 1
    ) {
      // A skipped logout or A -> B -> A must not transfer remembered preference.
      resetAccount();
    }
    owner = identity!.authSubject;
    generation = nextGeneration;
    if (!sessionOperation || !sessions.isCurrent(sessionOperation)) {
      sessionOperation = current;
      candidates = null;
      status = "discovery-required";
      const boundOperation = current;
      current.signal.addEventListener("abort", () => {
        if (sessionOperation !== boundOperation) return;
        candidates = null;
        status = "discovery-required";
        dropSelection();
      }, { once: true });
    }
  }

  function activate(householdId: string): void {
    const previous = controller;
    controller = new AbortController();
    selected = householdId;
    preferred = householdId;
    requiresExplicitSelection = false;
    revision += 1n;
    status = "selected";
    previous?.abort();
  }

  const guard: HouseholdSelectionGuard = {
    acceptDiscovery(operation, input) {
      reconcileSession();
      if (!sessions.isCurrent(operation)) return false;
      const fresh = copyDiscovery(input);
      if (!sessions.isCurrent(operation)) return false;
      const eligible = (id: string) =>
        fresh.households.some((candidate) => candidate.householdId === id);
      const previousCoreUserId = candidates?.coreUserId;
      candidates = fresh;
      if (selected && eligible(selected)) {
        if (previousCoreUserId !== fresh.coreUserId) activate(selected);
        return true;
      }
      if (preferred) {
        if (eligible(preferred)) {
          activate(preferred);
        } else {
          preferred = null;
          requiresExplicitSelection = true;
          status = "selection-lost";
          dropSelection();
        }
      } else if (requiresExplicitSelection) {
        status = status === "selection-lost" ? status : "selection-required";
      } else if (fresh.households.length === 1) {
        activate(fresh.households[0]!.householdId);
      } else {
        status = fresh.households.length === 0 ? "no-households" : "selection-required";
      }
      return true;
    },
    selectHousehold(householdId) {
      reconcileSession();
      if (!sessionOperation || !sessions.isCurrent(sessionOperation) || !candidates) return false;
      if (typeof householdId !== "string") return false;
      const id = householdId.toLowerCase();
      if (!candidates.households.some((candidate) => candidate.householdId === id)) return false;
      if (selected !== id) activate(id);
      return true;
    },
    getSnapshot() {
      reconcileSession();
      return Object.freeze({
        authSubject: owner,
        status,
        candidates: candidates ? copyDiscovery(candidates) : null,
        selectedHouseholdId: selected,
        revision,
      });
    },
    beginOperation() {
      reconcileSession();
      if (!selected || !candidates || !controller || !sessionOperation ||
          !sessions.isCurrent(sessionOperation)) return null;
      const handle: HouseholdOperationHandle = Object.freeze({
        [HOUSEHOLD_OPERATION_BRAND]: true as const,
        householdId: selected,
        coreUserId: candidates.coreUserId,
        signal: controller.signal,
        revision,
      });
      issued.set(handle, { session: sessionOperation, controller });
      return handle;
    },
    isCurrent(handle) {
      reconcileSession();
      const issuance = issued.get(handle);
      return !!issuance && sessions.isCurrent(issuance.session) &&
        issuance.controller === controller && !handle.signal.aborted &&
        handle.revision === revision && handle.householdId === selected &&
        handle.coreUserId === candidates?.coreUserId;
    },
    clearSelection() {
      reconcileSession();
      preferred = null;
      requiresExplicitSelection = true;
      status = owner ? "selection-required" : "unauthenticated";
      dropSelection();
    },
    invalidateEligibility() {
      reconcileSession();
      candidates = null;
      status = owner ? "access-invalidated" : "unauthenticated";
      dropSelection();
    },
    clearAccount() {
      resetAccount();
    },
  };
  return Object.freeze(guard);
}
