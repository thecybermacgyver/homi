import { useEffect, useRef, useState } from "react";
import { BottomSheet, Button, SearchField } from "@homi/ui";
import type {
  HomiWebModuleSearchProvider,
  HomiWebModuleSearchResult,
  HomiWebModuleSearchHost,
} from "@homi/module-sdk";

export interface GlobalSearchSource {
  readonly moduleKey: string;
  readonly provider: HomiWebModuleSearchProvider;
  readonly host: HomiWebModuleSearchHost;
}

interface SearchGroup {
  readonly moduleKey: string;
  readonly label: string;
  readonly results: readonly HomiWebModuleSearchResult[];
  readonly failed: boolean;
}

const MAX_RESULTS_PER_MODULE = 20;
const PROVIDER_TIMEOUT_MS = 4000;
const DEBOUNCE_MS = 200;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("Search timed out.")),
      PROVIDER_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function GlobalSearch({
  open,
  sources,
  onClose,
  onChoose,
}: {
  open: boolean;
  sources: readonly GlobalSearchSource[];
  onClose(): void;
  onChoose(moduleKey: string, result: HomiWebModuleSearchResult): void;
}) {
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<readonly SearchGroup[]>([]);
  const [searching, setSearching] = useState(false);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const trimmed = query.trim();

  useEffect(() => {
    if (!open) {
      setQuery("");
      setGroups([]);
      setSearching(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || trimmed === "") {
      setGroups([]);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void Promise.all(
        sourcesRef.current.map(async (source): Promise<SearchGroup> => {
          try {
            const results = await withTimeout(
              source.provider.search(trimmed, source.host),
            );
            return {
              moduleKey: source.moduleKey,
              label: source.provider.label,
              results: results.slice(0, MAX_RESULTS_PER_MODULE),
              failed: false,
            };
          } catch {
            return {
              moduleKey: source.moduleKey,
              label: source.provider.label,
              results: [],
              failed: true,
            };
          }
        }),
      ).then((next) => {
        if (!active) return;
        setGroups(next);
        setSearching(false);
      });
    }, DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, trimmed]);

  const total = groups.reduce((sum, group) => sum + group.results.length, 0);
  const anyFailed = groups.some((group) => group.failed);

  return (
    <BottomSheet
      open={open}
      title="Search Homi"
      onDismiss={onClose}
      actions={
        <Button variant="quiet" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="homi-global-search">
        <SearchField
          label="Search everything in Homi"
          placeholder="Search events, transactions, shopping…"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <p className="homi-global-search__status" role="status">
          {trimmed === ""
            ? "Searches every module that is turned on, including on this device while offline."
            : searching
              ? "Searching…"
              : total === 0
                ? anyFailed
                  ? "No matches, and some modules could not be searched."
                  : "No matches in any module."
                : `${total} match${total === 1 ? "" : "es"}${anyFailed ? ", but some modules could not be searched" : ""}.`}
        </p>
        {groups
          .filter((group) => group.results.length > 0)
          .map((group) => (
            <section
              key={group.moduleKey}
              className="homi-global-search__group"
              aria-label={group.label}
            >
              <h3>{group.label}</h3>
              <div role="list">
                {group.results.map((result) => (
                  <button
                    type="button"
                    role="listitem"
                    key={result.id}
                    className="homi-global-search__result"
                    onClick={() => onChoose(group.moduleKey, result)}
                  >
                    <span>
                      <strong>{result.title}</strong>
                      {result.subtitle && <small>{result.subtitle}</small>}
                    </span>
                    {result.detail && <span>{result.detail}</span>}
                  </button>
                ))}
              </div>
            </section>
          ))}
      </div>
    </BottomSheet>
  );
}
