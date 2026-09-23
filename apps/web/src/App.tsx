import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  HomiFamilyBoardSlot,
  HomiWebModuleContextActions,
} from "@homi/module-sdk";
import {
  AppShell,
  Button,
  EmptyState,
  FormField,
  Notice,
  PageHeader,
  Surface,
  TextField,
  type NavigationItem,
} from "@homi/ui";
import {
  HomiAuthActionError,
  signInWithEmail,
  signOut,
} from "./auth-actions.js";
import {
  createAppSyncRuntime,
  type AppSyncRuntime,
} from "./sync/app-sync-runtime.js";
import {
  deleteCachedRecord,
  dismissModuleMutation,
  enqueueMutation,
  getCachedRecord,
  getCachedRecords,
  getModuleMutations,
  retireQueuedMutationsForMissingModules,
  seedCachedRecord,
} from "./sync/local-db.js";
import { projectWorkingEntities } from "./sync/working-entities.js";
import { HouseholdModulesPage } from "./HouseholdModulesPage.js";
import {
  cacheMemberModulePreferences,
  fetchMemberModulePreferences,
  getEffectiveMemberModulePreferences,
  type MemberModulePreferenceSnapshot,
} from "./sync/member-module-preferences.js";
import {
  cacheHomiModuleRuntime,
  fetchHomiModuleRuntime,
  getCachedHomiModuleRuntime,
  loadHomiWebModules,
  type HomiWebModuleLoadFailure,
  type LoadedHomiWebModule,
} from "./module-runtime/host.js";

type CoreView = "home" | "modules" | "settings";
type AppView = CoreView | string;

const FOREGROUND_SYNC_INTERVAL_MS = 15_000;

const CORE_NAVIGATION: readonly NavigationItem[] = Object.freeze([
  { id: "home", label: "Dashboard", icon: <span aria-hidden="true">⌂</span> },
  { id: "modules", label: "Modules", icon: <span aria-hidden="true">▦</span> },
  { id: "settings", label: "Settings", icon: <span aria-hidden="true">⚙</span> },
]);

const FAMILY_BOARD_PRESENTATION: Record<
  HomiFamilyBoardSlot,
  { readonly label: string; readonly className: string }
> = Object.freeze({
  "weather-overview": {
    label: "Daily Forecast & Overview",
    className: "homi-family-card--weather",
  },
  "meal-planner": {
    label: "Weekly Meal Planner",
    className: "homi-family-card--meals",
  },
  noticeboard: {
    label: "Living Room Noticeboard",
    className: "homi-family-card--noticeboard",
  },
  "grocery-inventory": {
    label: "Actionable Grocery Inventory",
    className: "homi-family-card--grocery",
  },
  "chore-board": {
    label: "Task & Chore Board",
    className: "homi-family-card--chores",
  },
  "family-schedule": {
    label: "Family Schedule",
    className: "homi-family-card--schedule",
  },
});

function useRuntimeSnapshot(runtime: AppSyncRuntime) {
  return useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
}

function readableFailure(error: unknown): string {
  if (error instanceof HomiAuthActionError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "The request could not be completed.";
}

function formatSyncTime(value: string | null): string {
  if (!value) return "Waiting for first sync";
  return (
    "Last synced " +
    new Date(value).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })
  );
}

function modulePageViewId(
  moduleKey: string,
  pageId: string,
): string {
  return `module:${moduleKey}:page:${pageId}`;
}

function moduleSettingsViewId(
  moduleKey: string,
  scope: "household" | "user",
): string {
  return `module:${moduleKey}:settings:${scope}`;
}

export function App() {
  const runtime = useMemo(() => createAppSyncRuntime(), []);
  const sync = useRuntimeSnapshot(runtime);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [activeView, setActiveView] = useState<AppView>("home");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authFailure, setAuthFailure] = useState<string | null>(null);
  const [loadedModules, setLoadedModules] = useState<
    readonly LoadedHomiWebModule[]
  >([]);
  const [moduleLoadFailures, setModuleLoadFailures] = useState<
    readonly HomiWebModuleLoadFailure[]
  >([]);
  const [moduleRuntimeFailure, setModuleRuntimeFailure] =
    useState<string | null>(null);
  const [moduleRuntimeLoading, setModuleRuntimeLoading] =
    useState(false);
  const [moduleLoadRetryGeneration, setModuleLoadRetryGeneration] =
    useState(0);
  const [
    moduleRuntimeRefreshGeneration,
    setModuleRuntimeRefreshGeneration,
  ] = useState(0);
  const [memberModulePreferences, setMemberModulePreferences] = useState<
    readonly MemberModulePreferenceSnapshot[]
  >([]);
  const [modulePreferenceFailure, setModulePreferenceFailure] =
    useState<string | null>(null);
  const [moduleContextActions, setModuleContextActions] = useState<{
    readonly moduleKey: string;
    readonly actions: HomiWebModuleContextActions;
  } | null>(null);
  const firstSyncGeneration = useRef<string | null>(null);
  const loadedRuntimeIdentity = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    const refresh = () => {
      if (!active || !navigator.onLine) return;
      void runtime.refreshContext().catch(() => undefined);
    };
    const refreshModuleRuntime = () => {
      if (
        !active ||
        !navigator.onLine ||
        document.visibilityState !== "visible"
      ) {
        return;
      }
      setModuleRuntimeRefreshGeneration((current) => current + 1);
    };

    const handleOnline = () => {
      setOnline(true);
      refresh();
    };
    const handleOffline = () => {
      setOnline(false);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);
    const syncInterval = window.setInterval(
      refreshModuleRuntime,
      FOREGROUND_SYNC_INTERVAL_MS,
    );

    void runtime
      .hydrateOfflineContext()
      .catch((error: unknown) => {
        setAuthFailure(readableFailure(error));
      })
      .finally(() => {
        refresh();
      });

    return () => {
      active = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearInterval(syncInterval);
      runtime.invalidate();
    };
  }, [runtime]);

  const context = sync.context;
  const household = context.household;
  const candidates = household.candidates?.households ?? [];
  const selected = household.selectedHouseholdId;
  const selectedName =
    candidates.find((item) => item.householdId === selected)?.name ??
    sync.offlineContext?.householdName ??
    "Household";

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authBusy) return;

    const controller = new AbortController();
    setAuthBusy(true);
    setAuthFailure(null);

    try {
      await signInWithEmail(email, password, controller.signal);
      setPassword("");
      await runtime.refreshContext(controller.signal);
    } catch (error) {
      setAuthFailure(readableFailure(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    if (authBusy) return;

    const controller = new AbortController();
    setAuthBusy(true);
    setAuthFailure(null);

    try {
      await signOut(controller.signal);
      await runtime.clearOfflineContext();
      runtime.invalidate();
      setPassword("");
      setActiveView("home");
    } catch (error) {
      setAuthFailure(readableFailure(error));
    } finally {
      setAuthBusy(false);
    }
  }

  const authenticated =
    household.authSubject !== null &&
    context.status !== "unauthenticated";
  const transportFallback =
    context.status === "failed" &&
    (context.failure?.code?.includes("TRANSPORT") ?? false);
  const offlineReady =
    !authenticated &&
    sync.offlineContext !== null &&
    (!online || transportFallback);
  const effectiveOffline = !online || offlineReady;
  const displayAuthenticated = authenticated || offlineReady;
  const ready = context.status === "ready";
  const displayLocale = ready
    ? context.context.locale
    : sync.offlineContext?.locale ?? "";
  const displayTimeZone = ready
    ? context.context.timeZone
    : sync.offlineContext?.timeZone ?? "UTC";
  const moduleAuthSubject = ready
    ? context.household.authSubject
    : sync.offlineContext?.authSubject ?? null;
  const moduleHouseholdId = ready
    ? context.context.householdId
    : sync.offlineContext?.householdId ?? null;
  const moduleClientId = ready
    ? context.context.clientId
    : sync.offlineContext?.clientId ?? null;
  const moduleManagementOnline = ready && online;
  const moduleRuntimeIdentity =
    moduleAuthSubject &&
    moduleHouseholdId &&
    moduleClientId
      ? [
          moduleAuthSubject,
          moduleHouseholdId,
          moduleClientId,
        ].join(":")
      : null;
  const moduleRuntimeGeneration =
    ready && moduleRuntimeIdentity
      ? [
          moduleRuntimeIdentity,
          context.context.requestId,
        ].join(":")
      : offlineReady && moduleRuntimeIdentity
        ? `${moduleRuntimeIdentity}:offline`
        : null;

  const moduleSurfaceContext = useMemo(
    () =>
      moduleAuthSubject &&
      moduleHouseholdId &&
      moduleClientId
        ? {
            authSubject: moduleAuthSubject,
            householdId: moduleHouseholdId,
            clientId: moduleClientId,
            locale: displayLocale || "en",
            timeZone: displayTimeZone || "UTC",
            online: Boolean(moduleManagementOnline),
          }
        : null,
    [
      moduleAuthSubject,
      moduleHouseholdId,
      moduleClientId,
      displayLocale,
      displayTimeZone,
      moduleManagementOnline,
    ],
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    if (!moduleAuthSubject || !moduleHouseholdId || !moduleClientId) {
      setMemberModulePreferences([]);
      setModulePreferenceFailure(null);
      return () => controller.abort();
    }

    void (async () => {
      try {
        const cached = await getEffectiveMemberModulePreferences(
          moduleAuthSubject,
          moduleHouseholdId,
        );
        if (active) setMemberModulePreferences(cached);

        if (!moduleManagementOnline) return;

        const remote = await fetchMemberModulePreferences(
          {
            householdId: moduleHouseholdId,
            clientId: moduleClientId,
          },
          controller.signal,
        );
        await cacheMemberModulePreferences(
          moduleAuthSubject,
          moduleHouseholdId,
          remote,
        );
        const effective = await getEffectiveMemberModulePreferences(
          moduleAuthSubject,
          moduleHouseholdId,
        );
        if (active) {
          setMemberModulePreferences(effective);
          setModulePreferenceFailure(null);
        }
      } catch (error) {
        if (active && !controller.signal.aborted) {
          setModulePreferenceFailure(readableFailure(error));
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    activeView,
    moduleAuthSubject,
    moduleClientId,
    moduleHouseholdId,
    moduleManagementOnline,
    sync.lastSuccessfulSyncAt,
  ]);

  useEffect(() => {
    if (
      moduleLoadFailures.length === 0 ||
      !moduleManagementOnline ||
      document.visibilityState !== "visible"
    ) {
      return;
    }
    const retryTimer = window.setTimeout(
      () => setModuleLoadRetryGeneration((current) => current + 1),
      FOREGROUND_SYNC_INTERVAL_MS,
    );
    return () => window.clearTimeout(retryTimer);
  }, [moduleLoadFailures.length, moduleManagementOnline]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    if (
      !moduleRuntimeIdentity ||
      !moduleAuthSubject ||
      !moduleHouseholdId ||
      !moduleClientId
    ) {
      loadedRuntimeIdentity.current = null;
      firstSyncGeneration.current = null;
      runtime.setModuleSyncContributions({
        mutationAdapters: [],
        changeHandlers: [],
      });
      setLoadedModules([]);
      setModuleLoadFailures([]);
      setModuleRuntimeFailure(null);
      setModuleRuntimeLoading(false);
      return () => controller.abort();
    }

    if (
      loadedRuntimeIdentity.current !==
      moduleRuntimeIdentity
    ) {
      loadedRuntimeIdentity.current =
        moduleRuntimeIdentity;
      firstSyncGeneration.current = null;
      runtime.setModuleSyncContributions({
        mutationAdapters: [],
        changeHandlers: [],
      });
      setLoadedModules([]);
      setModuleLoadFailures([]);
    }

    setModuleRuntimeLoading(true);
    setModuleRuntimeFailure(null);

    const load = async () => {
      try {
        const descriptors = moduleManagementOnline
          ? await fetchHomiModuleRuntime(
              {
                householdId: moduleHouseholdId,
                clientId: moduleClientId,
              },
              controller.signal,
            )
          : await getCachedHomiModuleRuntime(
              moduleAuthSubject,
              moduleHouseholdId,
            );

        if (moduleManagementOnline) {
          await cacheHomiModuleRuntime(
            moduleAuthSubject,
            moduleHouseholdId,
            descriptors,
          );
          await retireQueuedMutationsForMissingModules(
            moduleAuthSubject,
            moduleHouseholdId,
            new Set(
              descriptors.map((descriptor) => descriptor.moduleKey),
            ),
          );
        }

        const result = await loadHomiWebModules(
          descriptors,
          {
            authSubject: moduleAuthSubject,
            householdId: moduleHouseholdId,
            clientId: moduleClientId,
            locale: displayLocale,
            timeZone: displayTimeZone,
            online: moduleManagementOnline,
          },
        );

        if (!active || controller.signal.aborted) {
          return;
        }

        setLoadedModules(result.modules);
        setModuleLoadFailures(result.failures);

        const validModuleViews = new Set<string>();
        for (const module of result.modules) {
          if (!module.descriptor.enabled) continue;
          for (
            const navigation of
            module.descriptor.manifest.navigation
          ) {
            validModuleViews.add(
              modulePageViewId(
                module.descriptor.moduleKey,
                navigation.id,
              ),
            );
          }
          if (module.definition.settings?.household) {
            validModuleViews.add(
              moduleSettingsViewId(
                module.descriptor.moduleKey,
                "household",
              ),
            );
          }
          if (module.definition.settings?.user) {
            validModuleViews.add(
              moduleSettingsViewId(
                module.descriptor.moduleKey,
                "user",
              ),
            );
          }
        }
        setActiveView((current) =>
          current.startsWith("module:") &&
          !validModuleViews.has(current)
            ? "home"
            : current,
        );

        runtime.setModuleSyncContributions({
          mutationAdapters: result.modules.flatMap(
            (module) =>
              module.definition.sync
                ?.mutationAdapters ?? [],
          ),
          changeHandlers: result.modules.flatMap(
            (module) =>
              module.definition.sync
                ?.changeHandlers ?? [],
          ),
        });

        const syncGeneration =
          moduleRuntimeGeneration === null
            ? null
            : `${moduleRuntimeGeneration}:${moduleRuntimeRefreshGeneration}`;
        if (
          moduleManagementOnline &&
          syncGeneration &&
          firstSyncGeneration.current !== syncGeneration
        ) {
          firstSyncGeneration.current = syncGeneration;
          await runtime.syncNow(controller.signal);
        }
      } catch (error) {
        if (!active || controller.signal.aborted) {
          return;
        }
        runtime.setModuleSyncContributions({
          mutationAdapters: [],
          changeHandlers: [],
        });
        setLoadedModules([]);
        setModuleLoadFailures([]);
        setModuleRuntimeFailure(
          readableFailure(error),
        );
      } finally {
        if (active && !controller.signal.aborted) {
          setModuleRuntimeLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    displayLocale,
    displayTimeZone,
    moduleAuthSubject,
    moduleClientId,
    moduleHouseholdId,
    moduleManagementOnline,
    moduleLoadRetryGeneration,
    moduleRuntimeGeneration,
    moduleRuntimeIdentity,
    moduleRuntimeRefreshGeneration,
    runtime,
    sync.lastSuccessfulSyncAt,
  ]);

  if (!displayAuthenticated) {
    return (
      <main className="homi-platform-auth">
        <Surface className="homi-platform-auth__card">
          <img
            src="/brand/homi_logo.png"
            alt="Homi"
            className="homi-platform-auth__logo"
          />
          <p className="homi-ui-eyebrow">Home, together.</p>
          <h1>Welcome home</h1>
          <p className="homi-platform-auth__intro">
            Sign in to your household.
          </p>

          <form onSubmit={handleSignIn} className="homi-platform-auth__form">
            <FormField label="Email" htmlFor="homi-email">
              <TextField
                id="homi-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={authBusy}
                required
              />
            </FormField>
            <FormField label="Password" htmlFor="homi-password">
              <TextField
                id="homi-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={authBusy}
                required
              />
            </FormField>

            {authFailure && (
              <Notice tone="danger" title="Sign in needs attention">
                {authFailure}
              </Notice>
            )}

            <Button
              type="submit"
              disabled={authBusy || !online}
              className="homi-platform-auth__submit"
            >
              {authBusy ? "Signing in…" : online ? "Sign in" : "Offline"}
            </Button>
          </form>
        </Surface>
      </main>
    );
  }

  const enabledModules = loadedModules.filter(
    (module) => module.descriptor.enabled,
  );
  const modulePages = enabledModules.flatMap(
    (module) =>
      module.descriptor.manifest.navigation.map(
        (navigation) => ({
          module,
          navigation,
          viewId: modulePageViewId(
            module.descriptor.moduleKey,
            navigation.id,
          ),
          surface:
            module.definition.pages[navigation.id]!,
        }),
      ),
  );
  const appNavigation = CORE_NAVIGATION;
  const activeModulePage =
    modulePages.find(
      (page) => page.viewId === activeView,
    ) ?? null;
  const memberPreferenceBySurface = new Map(
    memberModulePreferences.map((preference) => [
      `${preference.moduleId}:${preference.surfaceId}`,
      preference,
    ] as const),
  );
  const familyBoardContributions = enabledModules
    .flatMap((module, moduleIndex) =>
      module.descriptor.manifest.extensions.familyBoard.flatMap(
        (contribution, contributionIndex) => {
          const preference = memberPreferenceBySurface.get(
            `${module.descriptor.id}:${contribution.surfaceId}`,
          );
          if (preference?.visible === false) return [];

          return [{
            module,
            label: contribution.label,
            slot: contribution.slot,
            surfaceId: contribution.surfaceId,
            surface:
              module.definition.familyBoard?.[
                contribution.surfaceId
              ]!,
            displayOrder:
              preference?.displayOrder ??
              1_000_000 + moduleIndex * 100 + contributionIndex,
            contributionIndex,
          }];
        },
      ),
    )
    .sort(
      (left, right) =>
        left.displayOrder - right.displayOrder ||
        left.module.descriptor.moduleKey.localeCompare(
          right.module.descriptor.moduleKey,
        ) ||
        left.contributionIndex - right.contributionIndex,
    );
  const moduleSettings = enabledModules.flatMap(
    (module) => {
      const settings = module.definition.settings;
      return [
        ...(settings?.household
          ? [
              {
                module,
                scope: "household" as const,
                viewId: moduleSettingsViewId(
                  module.descriptor.moduleKey,
                  "household",
                ),
                surface: settings.household,
              },
            ]
          : []),
        ...(settings?.user
          ? [
              {
                module,
                scope: "user" as const,
                viewId: moduleSettingsViewId(
                  module.descriptor.moduleKey,
                  "user",
                ),
                surface: settings.user,
              },
            ]
          : []),
      ];
    },
  );
  const activeModuleSetting =
    moduleSettings.find(
      (setting) => setting.viewId === activeView,
    ) ?? null;
  const ActiveModulePageSurface =
    activeModulePage?.surface ?? null;
  const ActiveModuleSetupSurface =
    activeModulePage?.module.definition.setup ?? null;
  const ActiveModuleSettingSurface =
    activeModuleSetting?.surface ?? null;

  function moduleActionsFor(moduleKey: string) {
    const module = enabledModules.find(
      (candidate) =>
        candidate.descriptor.moduleKey === moduleKey,
    );
    if (!module) {
      throw new Error(
        `Module '${moduleKey}' is not enabled in this household.`,
      );
    }

    const syncEntities = new Map(
      (module.descriptor.manifest.sync?.entities ?? []).map(
        (entity) => [entity.entityType, entity] as const,
      ),
    );

    function requireCacheEntityType(entityType: string) {
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(entityType)) {
        throw new Error(
          `Module '${moduleKey}' supplied invalid cache entity type '${entityType}'.`,
        );
      }
    }

    function requireSyncEntity(
      entityType: string,
      operation?: string,
    ) {
      const entity = syncEntities.get(entityType);
      if (!entity) {
        throw new Error(
          `Module '${moduleKey}' did not declare synchronized entity '${entityType}'.`,
        );
      }
      if (
        operation !== undefined &&
        !entity.operations.includes(
          operation as "create" | "update" | "delete",
        )
      ) {
        throw new Error(
          `Module '${moduleKey}' did not declare '${operation}' for synchronized entity '${entityType}'.`,
        );
      }
      return entity;
    }

    return {
      registerContextActions(actions: HomiWebModuleContextActions | null) {
        if (actions === null) {
          setModuleContextActions((current) =>
            current?.moduleKey === moduleKey ? null : current,
          );
          return;
        }
        for (const action of [actions.search, actions.create]) {
          if (
            action !== undefined &&
            (!action.label.trim() || typeof action.invoke !== "function")
          ) {
            throw new Error(
              `Module '${moduleKey}' supplied an invalid contextual action.`,
            );
          }
        }
        setModuleContextActions({ moduleKey, actions });
      },
      async refreshModuleState() {
        if (moduleManagementOnline) {
          await runtime.refreshContext();
        }
      },
      async syncNow() {
        if (moduleManagementOnline) {
          await runtime.syncNow();
        }
      },
      navigate(path: string) {
        const target = modulePages.find(
          (page) =>
            page.module.descriptor.moduleKey === moduleKey &&
            page.navigation.path === path,
        );
        if (target) {
          setActiveView(target.viewId);
        }
      },
      async enqueueMutation(input: {
        entityType: string;
        entityId: string;
        operation: string;
        baseRevision: string;
        payload: Record<string, unknown>;
      }) {
        if (!moduleAuthSubject || !moduleHouseholdId) {
          throw new Error(
            "A verified household context is required to queue a module mutation.",
          );
        }
        requireSyncEntity(
          input.entityType,
          input.operation,
        );
        const queued = await enqueueMutation(
          moduleAuthSubject,
          {
            householdId: moduleHouseholdId,
            moduleKey,
            entityType: input.entityType,
            entityId: input.entityId,
            operation: input.operation,
            baseRevision: input.baseRevision,
            payload: { ...input.payload },
          },
        );
        return Object.freeze({
          clientMutationId: queued.clientMutationId,
        });
      },
      async listMutations() {
        if (!moduleAuthSubject || !moduleHouseholdId) {
          return Object.freeze([]);
        }
        const mutations = await getModuleMutations(
          moduleAuthSubject,
          moduleHouseholdId,
          moduleKey,
        );
        return Object.freeze(
          mutations.map((mutation) =>
            Object.freeze({
              clientMutationId: mutation.clientMutationId,
              entityType: mutation.entityType,
              entityId: mutation.entityId,
              operation: mutation.operation,
              baseRevision: mutation.baseRevision,
              payload: Object.freeze({ ...mutation.payload }),
              status: mutation.status,
              attempts: mutation.attempts,
              createdAt: mutation.createdAt,
              updatedAt: mutation.updatedAt,
              errorCode: mutation.lastErrorCode ?? null,
              serverRevision: mutation.serverRevision ?? null,
              changeSequence: mutation.changeSequence ?? null,
              serverState: mutation.serverState ?? null,
            }),
          ),
        );
      },
      async dismissMutation(clientMutationId: string) {
        if (!moduleAuthSubject || !moduleHouseholdId) {
          throw new Error(
            "A verified household context is required to dismiss a module mutation.",
          );
        }
        await dismissModuleMutation(
          moduleAuthSubject,
          moduleHouseholdId,
          moduleKey,
          clientMutationId,
        );
      },
      async getCachedEntity(
        entityType: string,
        entityId: string,
      ) {
        if (!moduleAuthSubject || !moduleHouseholdId) {
          return null;
        }
        requireCacheEntityType(entityType);
        const record = await getCachedRecord(
          moduleAuthSubject,
          moduleHouseholdId,
          {
            moduleKey,
            entityType,
            entityId,
          },
        );
        return record
          ? Object.freeze({
              entityType: record.entityType,
              entityId: record.entityId,
              revision: record.revision,
              sequence: record.sequence,
              data: record.data,
            })
          : null;
      },
      async listCachedEntities(entityType: string) {
        if (!moduleAuthSubject || !moduleHouseholdId) {
          return Object.freeze([]);
        }
        requireCacheEntityType(entityType);
        const records = await getCachedRecords(
          moduleAuthSubject,
          moduleHouseholdId,
          moduleKey,
          entityType,
        );
        return Object.freeze(
          records.map((record) =>
            Object.freeze({
              entityType: record.entityType,
              entityId: record.entityId,
              revision: record.revision,
              sequence: record.sequence,
              data: record.data,
            }),
          ),
        );
      },
      async listWorkingEntities(entityType: string) {
        if (!moduleAuthSubject || !moduleHouseholdId) {
          return Object.freeze([]);
        }
        requireCacheEntityType(entityType);
        const [records, mutations] = await Promise.all([
          getCachedRecords(
            moduleAuthSubject,
            moduleHouseholdId,
            moduleKey,
            entityType,
          ),
          getModuleMutations(
            moduleAuthSubject,
            moduleHouseholdId,
            moduleKey,
          ),
        ]);
        return projectWorkingEntities(records, mutations, entityType);
      },
      async replaceCachedEntities(
        entityType: string,
        entities: readonly {
          entityId: string;
          revision: string;
          data: unknown;
        }[],
      ) {
        if (!moduleAuthSubject || !moduleHouseholdId) {
          throw new Error(
            "A verified household context is required to hydrate module cache.",
          );
        }
        requireCacheEntityType(entityType);
        const ids = new Set<string>();
        for (const entity of entities) {
          if (
            !entity.entityId.trim() ||
            !/^(0|[1-9][0-9]*)$/.test(entity.revision) ||
            ids.has(entity.entityId)
          ) {
            throw new Error(
              `Module '${moduleKey}' supplied an invalid authoritative snapshot for '${entityType}'.`,
            );
          }
          ids.add(entity.entityId);
        }

        const existing = await getCachedRecords(
          moduleAuthSubject,
          moduleHouseholdId,
          moduleKey,
          entityType,
        );

        await Promise.all([
          ...entities.map((entity) =>
            seedCachedRecord(moduleAuthSubject, {
              householdId: moduleHouseholdId,
              moduleKey,
              entityType,
              entityId: entity.entityId,
              revision: entity.revision,
              data: entity.data,
            }),
          ),
          ...existing
            .filter((record) => !ids.has(record.entityId))
            .map((record) =>
              deleteCachedRecord(
                moduleAuthSubject,
                moduleHouseholdId,
                {
                  moduleKey,
                  entityType,
                  entityId: record.entityId,
                },
              ),
            ),
        ]);
      },
    };
  }

  function renderFamilyBoardContribution(
    contribution: (typeof familyBoardContributions)[number],
  ): ReactNode {
    if (!moduleSurfaceContext || !contribution.surface) {
      return null;
    }

    const module = contribution.module;
    const presentation = FAMILY_BOARD_PRESENTATION[
      contribution.slot
    ];
    const requiresSetup =
      module.descriptor.manifest.setup?.required === true;
    const configured =
      module.descriptor.setupState === "configured";
    const ModuleSurface = contribution.surface;
    const firstPage = module.descriptor.manifest.navigation[0];
    const openModule = () => {
      if (firstPage) {
        setActiveView(
          modulePageViewId(
            module.descriptor.moduleKey,
            firstPage.id,
          ),
        );
      } else {
        setActiveView("modules");
      }
    };

    return (
      <article
        key={[
          module.descriptor.moduleKey,
          contribution.surfaceId,
        ].join(":")}
        className={[
          "homi-family-card",
          "homi-family-card--module-link",
          presentation.className,
        ].join(" ")}
        role="link"
        tabIndex={0}
        onClick={openModule}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openModule();
          }
        }}
      >
        <header className="homi-family-card__header">
          <div>
            <h2>{contribution.label}</h2>
            <p>{module.descriptor.manifest.name}</p>
          </div>
          <span
            className="homi-family-card__sparkle"
            aria-hidden="true"
          >
            ✦
          </span>
        </header>

        {requiresSetup && !configured ? (
          <div className="homi-family-placeholder homi-family-placeholder--module-setup">
            <strong>
              Set up {module.descriptor.manifest.name}
            </strong>
            <span>
              Finish this module’s setup before its Family Board
              content becomes active.
            </span>
            <Button
              variant="quiet"
              onClick={(event) => {
                event.stopPropagation();
                openModule();
              }}
            >
              Set up
            </Button>
          </div>
        ) : (
          <div className="homi-family-module-surface">
            <ModuleSurface
              context={moduleSurfaceContext}
              actions={moduleActionsFor(
                module.descriptor.moduleKey,
              )}
            />
          </div>
        )}
      </article>
    );
  }

  return (
    <AppShell
      brandIconSrc="/brand/homi_icon.png"
      variant={activeView === "home" ? "family-board" : "default"}
      items={appNavigation}
      activeId={
        activeModuleSetting
          ? "settings"
          : activeView
      }
      onNavigate={(id) => setActiveView(id)}
    >
      {offlineReady && (
        <Notice
          tone="warning"
          title="Working from the last verified household"
          className="homi-platform-notice"
        >
          Homi is available offline. Changes supported by enabled modules can
          synchronize when the connection returns.
        </Notice>
      )}

      {(ready || offlineReady) &&
        moduleRuntimeLoading &&
        loadedModules.length === 0 && (
          <Notice
            tone="neutral"
            title="Loading household modules"
            className="homi-platform-notice"
          >
            Homi is preparing the enabled household tools.
          </Notice>
        )}

      {(ready || offlineReady) &&
        moduleRuntimeFailure && (
          <Notice
            tone="danger"
            title="Module runtime needs attention"
            className="homi-platform-notice"
          >
            {moduleRuntimeFailure}
          </Notice>
        )}

      {(ready || offlineReady) &&
        moduleLoadFailures.length > 0 && (
          <Notice
            tone="warning"
            title="Some modules could not be loaded"
            className="homi-platform-notice"
          >
            {moduleLoadFailures
              .map(
                (failure) =>
                  `${failure.moduleKey}: ${failure.message}`,
              )
              .join(" · ")}
          </Notice>
        )}

      {(context.status === "selection-required" ||
        context.status === "selection-lost") && (
        <section className="homi-platform-page">
          <PageHeader
            eyebrow="Household"
            title="Choose your home"
            description="Select the household you want Homi to open."
          />
          <Surface className="homi-platform-choice-card">
            {context.status === "selection-lost" && (
              <Notice tone="warning">
                Your previous household is no longer available. Choose another
                household.
              </Notice>
            )}
            <div className="homi-platform-household-list">
              {candidates.map((candidate) => (
                <Button
                  key={candidate.householdId}
                  variant="secondary"
                  className="homi-platform-household-choice"
                  onClick={() =>
                    void runtime.selectHousehold(candidate.householdId)
                  }
                >
                  <span>{candidate.name}</span>
                  <span aria-hidden="true">›</span>
                </Button>
              ))}
            </div>
          </Surface>
        </section>
      )}

      {context.status === "no-households" && (
        <section className="homi-platform-page">
          <PageHeader
            eyebrow="Household"
            title="No household yet"
            description="This account does not currently belong to an active Homi household."
          />
        </section>
      )}

      {((context.status === "failed" && !offlineReady) ||
        context.status === "access-invalidated") && (
        <section className="homi-platform-page">
          <PageHeader
            eyebrow="Homi"
            title="Homi needs attention"
            description={
              context.failure?.message ??
              "The household context could not be loaded."
            }
          />
          <Button
            variant="secondary"
            onClick={() => void runtime.refreshContext()}
            disabled={!online}
          >
            Try again
          </Button>
        </section>
      )}

      {(ready || offlineReady) &&
        activeView === "home" && (
          <section
            className="homi-family-board"
            aria-label={`${selectedName} Family Board`}
          >
            <header className="homi-family-board__header">
              <div className="homi-family-board__brand">
                <img
                  src="/brand/homi_logo.png"
                  alt="Homi"
                  className="homi-family-board__logo"
                />
                <span className="homi-family-board__brand-subtitle">
                  Family Board
                </span>
              </div>
            </header>

            {modulePreferenceFailure && (
              <Notice
                tone="warning"
                title="Personal card layout needs attention"
                className="homi-platform-notice"
              >
                {modulePreferenceFailure}
              </Notice>
            )}

            <div className="homi-family-board__grid">
              {familyBoardContributions.length === 0 ? (
                <article className="homi-family-card">
                  <EmptyState
                    title="Your Family Board is ready"
                    description="Open Modules to choose which available module cards you want to see here."
                  />
                </article>
              ) : (
                familyBoardContributions.map(
                  renderFamilyBoardContribution,
                )
              )}
            </div>
          </section>
        )}

      {(ready || offlineReady) &&
        activeView === "modules" && (
          <section className="homi-platform-page">
            <PageHeader
              eyebrow="Modules"
              title="Choose what belongs in Homi"
              description="Modules are independent household tools. Each household can use the ones that fit and leave the rest off."
            />
            {moduleAuthSubject &&
              moduleHouseholdId &&
              moduleClientId && (
                <HouseholdModulesPage
                  authSubject={moduleAuthSubject}
                  householdId={moduleHouseholdId}
                  clientId={moduleClientId}
                  online={moduleManagementOnline}
                  syncToken={sync.lastSuccessfulSyncAt}
                  syncAfterChange={async () => {
                    if (moduleManagementOnline) {
                      await runtime.syncNow();
                    }
                  }}
                />
              )}
          </section>
        )}

      {(ready || offlineReady) &&
        activeView === "settings" && (
          <section className="homi-platform-page">
            <PageHeader
              eyebrow="Settings"
              title="Homi settings"
              description="Core settings stay available even when no feature modules are enabled."
            />

            <div className="homi-platform-settings-stack">
              <div className="homi-platform-detail-grid">
                <Surface className="homi-platform-detail-card">
                  <span className="homi-platform-card-kicker">Household</span>
                  <strong>{selectedName}</strong>
                  <p>Shared household identity and settings are owned by Homi Core.</p>
                </Surface>
                <Surface className="homi-platform-detail-card">
                  <span className="homi-platform-card-kicker">Language</span>
                  <strong>{displayLocale || "Default"}</strong>
                  <p>Homi resolves the household experience using the active locale.</p>
                </Surface>
                <Surface className="homi-platform-detail-card">
                  <span className="homi-platform-card-kicker">Time zone</span>
                  <strong>{displayTimeZone}</strong>
                  <p>Modules receive the trusted household time zone from Homi.</p>
                </Surface>
              </div>
              <Surface className="homi-platform-setting-row">
                <div>
                  <span className="homi-platform-card-kicker">Sync</span>
                  <strong>
                    {offlineReady
                      ? "Offline"
                      : sync.activity === "synchronizing"
                        ? "Syncing…"
                        : sync.lastCycle?.status === "failed"
                          ? "Needs attention"
                          : "Ready"}
                  </strong>
                  <p>{formatSyncTime(sync.lastSuccessfulSyncAt)}</p>
                </div>
                {ready && (
                  <Button
                    variant="secondary"
                    onClick={() => void runtime.syncNow()}
                    disabled={!online || sync.activity !== "idle"}
                  >
                    {sync.activity === "synchronizing" ? "Syncing…" : "Sync now"}
                  </Button>
                )}
              </Surface>

              {sync.lastCycle?.failure && (
                <Notice tone="danger" title="Sync issue">
                  {sync.lastCycle.failure.message}
                </Notice>
              )}

              {moduleSettings.map((setting) => (
                <Surface
                  key={setting.viewId}
                  className="homi-platform-setting-row"
                >
                  <div>
                    <span className="homi-platform-card-kicker">
                      Module settings
                    </span>
                    <strong>
                      {setting.module.descriptor.manifest.name}
                    </strong>
                    <p>
                      {setting.scope === "household"
                        ? "Shared household settings"
                        : "Your personal module settings"}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setActiveView(setting.viewId)
                    }
                  >
                    Open
                  </Button>
                </Surface>
              ))}

              <Surface className="homi-platform-setting-row">
                <div>
                  <span className="homi-platform-card-kicker">Account</span>
                  <strong>Signed in</strong>
                  <p>Sign out clears the active offline household pointer on this device.</p>
                </div>
                <Button
                  variant="quiet"
                  onClick={() => void handleSignOut()}
                  disabled={authBusy || !online}
                >
                  Sign out
                </Button>
              </Surface>
            </div>
          </section>
        )}

      {(ready || offlineReady) &&
        activeModulePage &&
        moduleSurfaceContext &&
        ActiveModulePageSurface && (
          <section className="homi-platform-page">
            {activeModulePage.module.descriptor.manifest
              .setup?.required === true &&
            activeModulePage.module.descriptor.setupState !==
              "configured" ? (
              activeModulePage.module.descriptor.setupState ===
                "unconfigured" &&
              ActiveModuleSetupSurface ? (
                <>
                  {!moduleManagementOnline && (
                    <Notice
                      tone="warning"
                      title="Setup is offline"
                      className="homi-platform-notice"
                    >
                      You can review this setup screen offline, but
                      changes must be saved when Homi reconnects.
                    </Notice>
                  )}
                  <ActiveModuleSetupSurface
                    context={moduleSurfaceContext}
                    actions={moduleActionsFor(
                      activeModulePage.module.descriptor.moduleKey,
                    )}
                  />
                </>
              ) : (
                <Notice
                  tone="warning"
                  title="Module setup is unavailable"
                >
                  Homi cannot verify the required setup state for{" "}
                  {
                    activeModulePage.module.descriptor.manifest
                      .name
                  }
                  .
                </Notice>
              )
            ) : (
              <ActiveModulePageSurface
                context={moduleSurfaceContext}
                actions={moduleActionsFor(
                  activeModulePage.module.descriptor.moduleKey,
                )}
              />
            )}
          </section>
        )}

      {activeModulePage &&
        moduleContextActions?.moduleKey ===
          activeModulePage.module.descriptor.moduleKey &&
        (moduleContextActions.actions.search ||
          moduleContextActions.actions.create) && (
          <div
            className="homi-platform-context-actions"
            aria-label="Module actions"
          >
            {moduleContextActions.actions.search && (
              <button
                type="button"
                className="homi-platform-context-action"
                aria-label={moduleContextActions.actions.search.label}
                title={moduleContextActions.actions.search.label}
                disabled={
                  moduleContextActions.actions.search.available === false
                }
                onClick={() =>
                  moduleContextActions.actions.search?.invoke()
                }
              >
                🔍
              </button>
            )}
            {moduleContextActions.actions.create && (
              <button
                type="button"
                className="homi-platform-context-action homi-platform-context-action--primary"
                aria-label={moduleContextActions.actions.create.label}
                title={moduleContextActions.actions.create.label}
                disabled={
                  moduleContextActions.actions.create.available === false
                }
                onClick={() =>
                  moduleContextActions.actions.create?.invoke()
                }
              >
                ＋
              </button>
            )}
          </div>
        )}

      {(ready || offlineReady) &&
        activeModuleSetting &&
        moduleSurfaceContext &&
        ActiveModuleSettingSurface && (
          <section className="homi-platform-page">
            <div className="homi-platform-module-settings-back">
              <Button
                variant="quiet"
                onClick={() => setActiveView("settings")}
              >
                Back to Homi settings
              </Button>
            </div>
            <ActiveModuleSettingSurface
              context={moduleSurfaceContext}
              actions={moduleActionsFor(
                activeModuleSetting.module.descriptor.moduleKey,
              )}
            />
          </section>
        )}
    </AppShell>
  );
}
