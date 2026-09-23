import {
  useEffect,
  useState,
} from "react";
import {
  Badge,
  Button,
  EmptyState,
  Notice,
  Surface,
} from "@homi/ui";
import {
  cacheHouseholdModuleCatalog,
  fetchHouseholdModules,
  getCachedHouseholdModules,
  updateHouseholdModule,
  type HouseholdModuleSnapshot,
} from "./sync/household-modules.js";
import {
  fetchModuleDirectory,
  installDirectoryModule,
  uninstallModule,
  type ModuleDirectoryEntry,
} from "./sync/module-directory.js";
import {
  cacheMemberModulePreferences,
  fetchMemberModulePreferences,
  getEffectiveMemberModulePreferences,
  queueMemberModulePreferenceUpdate,
  type MemberModulePreferenceSnapshot,
} from "./sync/member-module-preferences.js";

export interface HouseholdModulesPageProps {
  readonly authSubject: string;
  readonly householdId: string;
  readonly clientId: string;
  readonly online: boolean;
  readonly syncToken: string | null;
  syncAfterChange(): Promise<void>;
}

function failureMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "The module catalog could not be loaded.";
}

function setupLabel(module: HouseholdModuleSnapshot): string {
  if (module.setupState === "unavailable") {
    return "Setup status unavailable";
  }
  if (module.setupRequired === false) return "No setup needed";
  if (module.setupState === "configured") return "Configured";
  return "Setup needed";
}

function setupTone(
  module: HouseholdModuleSnapshot,
): "neutral" | "success" | "warning" {
  if (module.setupState === "unavailable") return "warning";
  if (module.setupRequired === false) return "neutral";
  if (module.setupState === "configured") return "success";
  return "warning";
}

function newerVersion(candidate: string, current: string): boolean {
  const candidateParts = candidate.split("-")[0]?.split(".").map(Number);
  const currentParts = current.split("-")[0]?.split(".").map(Number);
  if (!candidateParts || !currentParts) return false;
  for (let index = 0; index < 3; index += 1) {
    const left = candidateParts[index] ?? 0;
    const right = currentParts[index] ?? 0;
    if (left !== right) return left > right;
  }
  return current.includes("-") && !candidate.includes("-");
}

export function HouseholdModulesPage({
  authSubject,
  householdId,
  clientId,
  online,
  syncToken,
  syncAfterChange,
}: HouseholdModulesPageProps) {
  const [modules, setModules] = useState<
    readonly HouseholdModuleSnapshot[]
  >([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyModuleKey, setBusyModuleKey] =
    useState<string | null>(null);
  const [directoryEntries, setDirectoryEntries] = useState<
    readonly ModuleDirectoryEntry[]
  >([]);
  const [directoryFailure, setDirectoryFailure] =
    useState<string | null>(null);
  const [installNotice, setInstallNotice] =
    useState<string | null>(null);
  const [busyPreferenceId, setBusyPreferenceId] =
    useState<string | null>(null);
  const [preferences, setPreferences] = useState<
    readonly MemberModulePreferenceSnapshot[]
  >([]);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const load = async () => {
      setLoading(true);
      setFailure(null);

      try {
        const cached = await getCachedHouseholdModules(
          authSubject,
          householdId,
        );
        if (active && cached.length > 0) {
          setModules(cached);
        }

        if (!online) {
          if (active) setCanManage(false);
          return;
        }

        const catalog = await fetchHouseholdModules(
          { householdId, clientId },
          controller.signal,
        );
        await cacheHouseholdModuleCatalog(
          authSubject,
          householdId,
          catalog.modules,
        );

        if (active) {
          setModules(catalog.modules);
          setCanManage(catalog.canManage);
        }
      } catch (error) {
        if (
          active &&
          !controller.signal.aborted
        ) {
          setFailure(failureMessage(error));
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    authSubject,
    householdId,
    clientId,
    online,
    syncToken,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void (async () => {
      if (!online) return;
      setDirectoryFailure(null);
      try {
        const directory = await fetchModuleDirectory(
          { householdId, clientId },
          controller.signal,
        );
        if (active) setDirectoryEntries(directory.entries);
      } catch (error) {
        if (active && !controller.signal.aborted) {
          setDirectoryFailure(failureMessage(error));
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [householdId, clientId, online, syncToken]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void (async () => {
      try {
        const cached = await getEffectiveMemberModulePreferences(
          authSubject,
          householdId,
        );
        if (active) setPreferences(cached);

        if (!online) return;

        const remote = await fetchMemberModulePreferences(
          { householdId, clientId },
          controller.signal,
        );
        await cacheMemberModulePreferences(
          authSubject,
          householdId,
          remote,
        );
        const effective = await getEffectiveMemberModulePreferences(
          authSubject,
          householdId,
        );
        if (active) setPreferences(effective);
      } catch (error) {
        if (active && !controller.signal.aborted) {
          setFailure(failureMessage(error));
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    authSubject,
    householdId,
    clientId,
    online,
    syncToken,
  ]);

  async function changeModule(
    module: HouseholdModuleSnapshot,
  ) {
    if (
      !online ||
      !canManage ||
      busyModuleKey !== null ||
      !module.available
    ) {
      return;
    }

    const nextEnabled = !module.enabled;
    setBusyModuleKey(module.moduleKey);
    setFailure(null);

    try {
      const updated = await updateHouseholdModule({
        householdId,
        clientId,
        moduleKey: module.moduleKey,
        enabled: nextEnabled,
        baseRevision: module.revision,
      });

      await cacheHouseholdModuleCatalog(
        authSubject,
        householdId,
        [updated],
      );

      setModules((current) =>
        current.map((item) =>
          item.id === updated.id ? updated : item
        ),
      );

      await syncAfterChange();
    } catch (error) {
      setFailure(failureMessage(error));

      if (online) {
        try {
          const catalog = await fetchHouseholdModules({
            householdId,
            clientId,
          });
          await cacheHouseholdModuleCatalog(
            authSubject,
            householdId,
            catalog.modules,
          );
          setModules(catalog.modules);
          setCanManage(catalog.canManage);
        } catch {
          // Preserve the original action failure for the household to see.
        }
      }
    } finally {
      setBusyModuleKey(null);
    }
  }

  async function installModule(
    entry: ModuleDirectoryEntry,
  ): Promise<void> {
    if (
      !online ||
      !canManage ||
      entry.revoked ||
      busyModuleKey !== null
    ) {
      return;
    }

    setBusyModuleKey(entry.moduleKey);
    setFailure(null);
    setInstallNotice(null);
    try {
      const result = await installDirectoryModule({
        householdId,
        clientId,
        moduleKey: entry.moduleKey,
      });
      setInstallNotice(
        `${entry.name} ${result.version} was installed safely. ` +
          "Homi is restarting to activate it.",
      );
      window.setTimeout(() => window.location.reload(), 5_000);
    } catch (error) {
      setFailure(failureMessage(error));
      setBusyModuleKey(null);
    }
  }

  async function removeModule(
    module: HouseholdModuleSnapshot,
  ): Promise<void> {
    if (
      !online ||
      !canManage ||
      module.enabled ||
      busyModuleKey !== null
    ) {
      return;
    }
    if (!window.confirm(
      `Uninstall ${module.name}? Its household data will be kept for a future reinstall.`,
    )) {
      return;
    }

    setBusyModuleKey(module.moduleKey);
    setFailure(null);
    setInstallNotice(null);
    try {
      await uninstallModule({
        householdId,
        clientId,
        moduleKey: module.moduleKey,
      });
      setInstallNotice(
        `${module.name} was uninstalled safely. Its household data was kept. ` +
          "Homi is restarting to finish the change.",
      );
      window.setTimeout(() => window.location.reload(), 5_000);
    } catch (error) {
      setFailure(failureMessage(error));
      setBusyModuleKey(null);
    }
  }

  async function reloadPreferences(): Promise<void> {
    setPreferences(
      await getEffectiveMemberModulePreferences(
        authSubject,
        householdId,
      ),
    );
  }

  async function changePreference(
    preference: MemberModulePreferenceSnapshot,
    patch: { visible?: boolean; displayOrder?: number },
  ): Promise<void> {
    if (busyPreferenceId !== null) return;
    setBusyPreferenceId(preference.id);
    setFailure(null);
    try {
      await queueMemberModulePreferenceUpdate(
        authSubject,
        householdId,
        preference,
        patch,
      );
      await reloadPreferences();
      if (online) {
        await syncAfterChange();
        await reloadPreferences();
      }
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setBusyPreferenceId(null);
    }
  }

  async function movePreference(
    preference: MemberModulePreferenceSnapshot,
    direction: -1 | 1,
  ): Promise<void> {
    if (busyPreferenceId !== null || !preference.visible) return;
    const visible = preferences.filter((item) => item.visible);
    const index = visible.findIndex(
      (item) => item.id === preference.id,
    );
    const neighbor = visible[index + direction];
    if (!neighbor) return;

    setBusyPreferenceId(preference.id);
    setFailure(null);
    try {
      await queueMemberModulePreferenceUpdate(
        authSubject,
        householdId,
        preference,
        { displayOrder: neighbor.displayOrder },
      );
      await queueMemberModulePreferenceUpdate(
        authSubject,
        householdId,
        neighbor,
        { displayOrder: preference.displayOrder },
      );
      await reloadPreferences();
      if (online) {
        await syncAfterChange();
        await reloadPreferences();
      }
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setBusyPreferenceId(null);
    }
  }

  const directoryCandidates = directoryEntries.filter((entry) => {
    const installed = modules.find(
      (module) => module.moduleKey === entry.moduleKey,
    );
    return (
      entry.revoked ||
      !installed ||
      newerVersion(entry.latestVersion, installed.version)
    );
  });

  return (
    <>
      {!online && (
        <Notice
          tone="warning"
          title="Module controls are offline"
          className="homi-platform-module-notice"
        >
          Homi is showing the last verified household module state.
          You can still change which module cards appear on your Homi and
          their order; those personal changes will synchronize after reconnecting.
        </Notice>
      )}

      {failure && (
        <Notice
          tone="danger"
          title="Module management needs attention"
          className="homi-platform-module-notice"
        >
          {failure}
        </Notice>
      )}

      {directoryFailure && online && (
        <Notice
          tone="warning"
          title="Module directory unavailable"
          className="homi-platform-module-notice"
        >
          Installed modules remain usable. {directoryFailure}
        </Notice>
      )}

      {installNotice && (
        <Notice
          tone="success"
          title="Module change completed"
          className="homi-platform-module-notice"
        >
          {installNotice}
        </Notice>
      )}

      {directoryEntries.length > 0 &&
        directoryCandidates.length === 0 &&
        modules.length > 0 && (
          <Notice
            tone="success"
            title="All modules are current"
            className="homi-platform-module-notice"
          >
            Every module in Homi&apos;s trusted directory is installed
            and up to date.
          </Notice>
        )}

      {directoryCandidates.length > 0 && (
        <section aria-labelledby="available-modules-heading">
          <h2 id="available-modules-heading">Available modules</h2>
          <p>
            Verified releases from Homi&apos;s trusted GitHub directory.
            Installation is limited to household administrators.
          </p>
          <div className="homi-platform-module-grid">
            {directoryCandidates.map((entry) => {
              const installed = modules.find(
                (module) => module.moduleKey === entry.moduleKey,
              );
              const updating = installed !== undefined;
              return (
                <Surface
                  key={entry.moduleKey}
                  className="homi-platform-module-card"
                >
                  <div className="homi-platform-module-card__heading">
                    <div>
                      <span className="homi-platform-card-kicker">
                        {entry.publisher}
                      </span>
                      <h3>{entry.name}</h3>
                      <p>{entry.description}</p>
                    </div>
                    <Badge tone={entry.revoked ? "warning" : "neutral"}>
                      {entry.revoked
                        ? "Revoked"
                        : updating
                          ? "Update available"
                          : "Available"}
                    </Badge>
                  </div>
                  <div className="homi-platform-module-card__actions">
                    <span>Version {entry.latestVersion}</span>
                    <Button
                      variant="secondary"
                      disabled={
                        !online ||
                        !canManage ||
                        entry.revoked ||
                        busyModuleKey !== null
                      }
                      onClick={() => void installModule(entry)}
                    >
                      {busyModuleKey === entry.moduleKey
                        ? "Installing safely…"
                        : updating
                          ? "Update"
                          : "Install"}
                    </Button>
                  </div>
                </Surface>
              );
            })}
          </div>
        </section>
      )}

      {!loading && modules.length === 0 ? (
        <Surface>
          <EmptyState
            title="No modules installed yet"
            description="Homi Core is ready. Installed modules will appear here so this household can choose which tools to use."
          />
        </Surface>
      ) : (
        <div className="homi-platform-module-grid">
          {modules.map((module) => (
            <Surface
              key={module.id}
              className="homi-platform-module-card"
            >
              <div className="homi-platform-module-card__heading">
                <div>
                  <span className="homi-platform-card-kicker">
                    {module.publisher}
                  </span>
                  <h2>{module.name}</h2>
                  <p>
                    Version {module.version}
                  </p>
                </div>
                <Badge
                  tone={
                    !module.available
                      ? "warning"
                      : module.enabled
                        ? "success"
                        : "neutral"
                  }
                >
                  {!module.available
                    ? "Unavailable"
                    : module.enabled
                      ? "Enabled"
                      : "Off"}
                </Badge>
              </div>

              <div className="homi-platform-module-card__status">
                <Badge tone={setupTone(module)}>
                  {setupLabel(module)}
                </Badge>
                {module.setupRequired === true &&
                  module.enabled &&
                  module.setupState === "unconfigured" && (
                    <span>
                      Setup will open through the Homi module host once
                      this module is activated in the shared runtime.
                    </span>
                  )}
                {module.setupRequired === true &&
                  module.enabled &&
                  module.setupState === "unavailable" && (
                    <span>
                      This module does not currently expose its required
                      setup status to Homi.
                    </span>
                  )}
              </div>

              {module.enabled && (() => {
                const modulePreferences = preferences.filter(
                  (item) => item.moduleId === module.id,
                );
                if (modulePreferences.length === 0) return null;

                const visiblePreferences = preferences.filter(
                  (item) => item.visible,
                );

                return (
                  <div className="homi-platform-module-card__home-cards">
                    <strong>My Homi cards</strong>
                    {modulePreferences.map((preference) => {
                      const visibleIndex = visiblePreferences.findIndex(
                        (item) => item.id === preference.id,
                      );

                      return (
                        <div
                          key={preference.id}
                          className="homi-platform-module-card__home-card-row"
                        >
                          <div>
                            <span>{preference.label}</span>
                            <Badge
                              tone={
                                preference.visible ? "success" : "neutral"
                              }
                            >
                              {preference.visible
                                ? "Shown on My Homi"
                                : "Hidden from My Homi"}
                            </Badge>
                          </div>
                          <div className="homi-platform-module-card__actions">
                            <Button
                              variant="quiet"
                              disabled={busyPreferenceId !== null}
                              onClick={() =>
                                void changePreference(preference, {
                                  visible: !preference.visible,
                                })
                              }
                            >
                              {preference.visible ? "Hide" : "Show"}
                            </Button>
                            {preference.visible && (
                              <>
                                <Button
                                  variant="quiet"
                                  disabled={
                                    busyPreferenceId !== null ||
                                    visibleIndex <= 0
                                  }
                                  onClick={() =>
                                    void movePreference(preference, -1)
                                  }
                                >
                                  Move up
                                </Button>
                                <Button
                                  variant="quiet"
                                  disabled={
                                    busyPreferenceId !== null ||
                                    visibleIndex < 0 ||
                                    visibleIndex >=
                                      visiblePreferences.length - 1
                                  }
                                  onClick={() =>
                                    void movePreference(preference, 1)
                                  }
                                >
                                  Move down
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              <div className="homi-platform-module-card__actions">
                <span>
                  Household revision {module.revision}
                </span>
                {!module.enabled && (
                  <Button
                    variant="quiet"
                    disabled={
                      !online ||
                      !canManage ||
                      busyModuleKey !== null
                    }
                    onClick={() => void removeModule(module)}
                  >
                    {busyModuleKey === module.moduleKey
                      ? "Uninstalling safely…"
                      : "Uninstall"}
                  </Button>
                )}
                <Button
                  variant={module.enabled ? "quiet" : "secondary"}
                  disabled={
                    !online ||
                    !canManage ||
                    !module.available ||
                    busyModuleKey !== null
                  }
                  onClick={() => void changeModule(module)}
                >
                  {busyModuleKey === module.moduleKey
                    ? "Saving…"
                    : module.enabled
                      ? "Disable"
                      : "Enable"}
                </Button>
              </div>
            </Surface>
          ))}
        </div>
      )}

      {online && !loading && !canManage && modules.length > 0 && (
        <p className="homi-platform-module-caption">
          A household administrator can change which modules are enabled.
        </p>
      )}
    </>
  );
}
