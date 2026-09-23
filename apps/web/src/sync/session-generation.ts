const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AuthenticatedSessionIdentity {
  authSubject: string;
  sessionId: string;
}

export class SessionGenerationError extends Error {
  constructor(
    public readonly code: "SESSION_INVALID_IDENTITY",
    message: string,
  ) {
    super(message);
    this.name = "SessionGenerationError";
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function validateIdentity(
  identity: unknown,
): asserts identity is AuthenticatedSessionIdentity {
  if (
    typeof identity !== "object" ||
    identity === null ||
    !isUuid((identity as { authSubject?: unknown }).authSubject) ||
    !isUuid((identity as { sessionId?: unknown }).sessionId)
  ) {
    throw new SessionGenerationError(
      "SESSION_INVALID_IDENTITY",
      "authSubject and sessionId must be valid UUIDs.",
    );
  }
}

const sessionCheckControllers = new WeakMap<SessionCheckHandle, AbortController>();
const sessionCheckHandles = new WeakSet<SessionCheckHandle>();
const operationHandles = new WeakSet<AuthenticatedOperationHandle>();
const SESSION_CHECK_BRAND = Symbol("SessionCheckHandle");
const OPERATION_BRAND = Symbol("AuthenticatedOperationHandle");

export class SessionCheckHandle {
  readonly #guard: SessionGenerationGuard;
  readonly #sequence: number;
  readonly #controller: AbortController;

  constructor(
    brand: symbol,
    guard: SessionGenerationGuard,
    sequence: number,
    controller: AbortController,
  ) {
    if (brand !== SESSION_CHECK_BRAND) {
      throw new TypeError("Invalid session-check handle");
    }
    this.#guard = guard;
    this.#sequence = sequence;
    this.#controller = controller;
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  isOwnedBy(guard: SessionGenerationGuard): boolean {
    return this.#guard === guard;
  }

  isSequence(sequence: number): boolean {
    return this.#sequence === sequence;
  }
}

export class AuthenticatedOperationHandle {
  readonly #guard: SessionGenerationGuard;
  readonly #generation: number;
  readonly #authSubject: string;
  readonly #sessionId: string;
  readonly #controller: AbortController;

  constructor(
    brand: symbol,
    guard: SessionGenerationGuard,
    generation: number,
    identity: AuthenticatedSessionIdentity,
    controller: AbortController,
  ) {
    if (brand !== OPERATION_BRAND) {
      throw new TypeError("Invalid authenticated-operation handle");
    }
    this.#guard = guard;
    this.#generation = generation;
    this.#authSubject = identity.authSubject;
    this.#sessionId = identity.sessionId;
    this.#controller = controller;
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  isCurrentFor(
    guard: SessionGenerationGuard,
    generation: number,
    identity: AuthenticatedSessionIdentity,
    controller: AbortController,
  ): boolean {
    return (
      this.#guard === guard &&
      this.#generation === generation &&
      this.#authSubject === identity.authSubject &&
      this.#sessionId === identity.sessionId &&
      this.#controller === controller
    );
  }
}

export class SessionGenerationGuard {
  #generationCounter = 0;
  #sessionCheckSequence = 0;
  #currentIdentity: AuthenticatedSessionIdentity | null = null;
  #generationController: AbortController | null = null;
  #activeSessionCheck: SessionCheckHandle | null = null;

  beginSessionCheck(): SessionCheckHandle {
    const previousController = this.#activeSessionCheck
      ? sessionCheckControllers.get(this.#activeSessionCheck)
      : undefined;
    previousController?.abort();

    const controller = new AbortController();
    const sequence = ++this.#sessionCheckSequence;
    const handle = new SessionCheckHandle(
      SESSION_CHECK_BRAND,
      this,
      sequence,
      controller,
    );
    sessionCheckControllers.set(handle, controller);
    sessionCheckHandles.add(handle);
    this.#activeSessionCheck = handle;
    return handle;
  }

  acceptAuthenticatedSession(
    handle: SessionCheckHandle,
    identity: AuthenticatedSessionIdentity,
  ): boolean {
    validateIdentity(identity);

    if (!this.#isCurrentSessionCheck(handle)) {
      return false;
    }

    if (
      this.#currentIdentity?.authSubject === identity.authSubject &&
      this.#currentIdentity.sessionId === identity.sessionId
    ) {
      return true;
    }

    this.#invalidateAuthenticatedGeneration();
    this.#generationCounter += 1;
    this.#currentIdentity = { ...identity };
    this.#generationController = new AbortController();
    return true;
  }

  acceptUnauthenticatedSession(handle: SessionCheckHandle): boolean {
    if (!this.#isCurrentSessionCheck(handle)) {
      return false;
    }

    if (this.#currentIdentity === null) {
      return true;
    }

    this.#invalidateAuthenticatedGeneration();
    this.#generationCounter += 1;
    this.#currentIdentity = null;
    this.#generationController = null;
    return true;
  }

  beginOperation(): AuthenticatedOperationHandle | null {
    if (!this.#currentIdentity || !this.#generationController) {
      return null;
    }

    if (this.#generationController.signal.aborted) {
      return null;
    }

    const handle = new AuthenticatedOperationHandle(
      OPERATION_BRAND,
      this,
      this.#generationCounter,
      this.#currentIdentity,
      this.#generationController,
    );
    operationHandles.add(handle);
    return handle;
  }

  isCurrent(handle: AuthenticatedOperationHandle): boolean {
    if (!this.#currentIdentity || !this.#generationController) {
      return false;
    }

    return (
      operationHandles.has(handle) &&
      !this.#generationController.signal.aborted &&
      handle.isCurrentFor(
        this,
        this.#generationCounter,
        this.#currentIdentity,
        this.#generationController,
      )
    );
  }

  getCurrentSession(): AuthenticatedSessionIdentity | null {
    return this.#currentIdentity ? { ...this.#currentIdentity } : null;
  }

  getGeneration(): number {
    return this.#generationCounter;
  }

  invalidate(): void {
    const previousController = this.#activeSessionCheck
      ? sessionCheckControllers.get(this.#activeSessionCheck)
      : undefined;
    previousController?.abort();
    this.#activeSessionCheck = null;

    if (this.#currentIdentity !== null || this.#generationController !== null) {
      this.#invalidateAuthenticatedGeneration();
      this.#generationCounter += 1;
    }

    this.#currentIdentity = null;
    this.#generationController = null;
  }

  #isCurrentSessionCheck(handle: SessionCheckHandle): boolean {
    return (
      sessionCheckHandles.has(handle) &&
      handle.isOwnedBy(this) &&
      handle.isSequence(this.#sessionCheckSequence) &&
      this.#activeSessionCheck === handle &&
      !handle.signal.aborted
    );
  }

  #invalidateAuthenticatedGeneration(): void {
    this.#generationController?.abort();
  }
}

export function createSessionGenerationGuard(): SessionGenerationGuard {
  return new SessionGenerationGuard();
}
