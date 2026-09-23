import {
  type FormEvent,
  useEffect,
  useState,
} from "react";
import {
  HOMI_MODULE_API_VERSION,
  defineHomiWebModule,
  type HomiWebModuleHostContext,
  type HomiWebModuleSurfaceProps,
} from "@homi/module-sdk";
import {
  Button,
  FormField,
  ModuleHeader,
  SetupLayout,
  Surface,
  TextField,
} from "@homi/ui";
import { STARTER_MODULE_KEY } from "./constants.js";
import {
  starterItemChangeHandler,
  starterItemMutationAdapter,
  type StarterItemSnapshot,
} from "./sync.js";

interface StarterSetupSnapshot {
  readonly boardLabel: string;
  readonly revision: string;
}

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function starterHeaders(
  context: HomiWebModuleHostContext,
): Record<string, string> {
  return {
    "X-Homi-Household-ID": context.householdId,
    "X-Homi-Client-ID": context.clientId,
  };
}

function responseError(
  body: unknown,
  fallback: string,
): Error {
  if (
    isObject(body) &&
    isObject(body.error) &&
    typeof body.error.message === "string"
  ) {
    return new Error(body.error.message);
  }
  return new Error(fallback);
}

async function readResponse(
  response: Response,
): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "Starter returned an invalid JSON response.",
    );
  }
}

function parseSetup(
  value: unknown,
): StarterSetupSnapshot | null {
  if (value === null) return null;
  if (
    !isObject(value) ||
    typeof value.boardLabel !== "string" ||
    typeof value.revision !== "string" ||
    !/^[1-9][0-9]*$/.test(value.revision)
  ) {
    throw new Error(
      "Starter setup response is invalid.",
    );
  }
  return Object.freeze({
    boardLabel: value.boardLabel,
    revision: value.revision,
  });
}

async function loadSetup(
  context: HomiWebModuleHostContext,
): Promise<StarterSetupSnapshot | null> {
  const response = await fetch(
    "/api/v1/modules/starter/setup",
    {
      method: "GET",
      credentials: "same-origin",
      headers: starterHeaders(context),
    },
  );
  const body = await readResponse(response);
  if (!response.ok) {
    throw responseError(
      body,
      "Starter setup could not be loaded.",
    );
  }
  if (
    !isObject(body) ||
    !Object.hasOwn(body, "data")
  ) {
    throw new Error(
      "Starter setup response shape is invalid.",
    );
  }
  return parseSetup(body.data);
}

async function saveSetup(
  context: HomiWebModuleHostContext,
  boardLabel: string,
): Promise<StarterSetupSnapshot> {
  const response = await fetch(
    "/api/v1/modules/starter/setup",
    {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        ...starterHeaders(context),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ boardLabel }),
    },
  );
  const body = await readResponse(response);
  if (!response.ok) {
    throw responseError(
      body,
      "Starter setup could not be saved.",
    );
  }
  if (
    !isObject(body) ||
    !Object.hasOwn(body, "data")
  ) {
    throw new Error(
      "Starter setup response shape is invalid.",
    );
  }
  const setup = parseSetup(body.data);
  if (!setup) {
    throw new Error(
      "Starter setup response did not include settings.",
    );
  }
  return setup;
}

function parseCachedItem(
  value: unknown,
): StarterItemSnapshot | null {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.revision !== "string" ||
    !/^[1-9][0-9]*$/.test(value.revision) ||
    value.deleted !== false
  ) {
    return null;
  }

  return Object.freeze({
    id: value.id,
    title: value.title,
    revision: value.revision,
    deleted: false,
  });
}

async function loadCachedItems(
  actions: HomiWebModuleSurfaceProps["actions"],
): Promise<readonly StarterItemSnapshot[]> {
  const records = await actions.listCachedEntities(
    "item",
  );
  const items = records
    .map((record) => parseCachedItem(record.data))
    .filter(
      (item): item is StarterItemSnapshot =>
        item !== null,
    )
    .sort((left, right) =>
      left.title.localeCompare(right.title),
    );
  return Object.freeze(items);
}

function StarterModulePage({
  context,
  actions,
}: HomiWebModuleSurfaceProps) {
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<
    readonly StarterItemSnapshot[]
  >([]);
  const [message, setMessage] = useState<string | null>(
    null,
  );

  async function reload(): Promise<void> {
    setItems(await loadCachedItems(actions));
  }

  useEffect(() => {
    void reload();
  }, [context.householdId]);

  async function finishQueuedAction(
    queuedMessage: string,
  ): Promise<void> {
    if (context.online) {
      await actions.syncNow();
      await reload();
      setMessage("Saved and synchronized.");
    } else {
      setMessage(queuedMessage);
    }
  }

  async function createItem(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;

    try {
      await actions.enqueueMutation({
        entityType: "item",
        entityId: crypto.randomUUID(),
        operation: "create",
        baseRevision: "0",
        payload: { title: nextTitle },
      });
      setTitle("");
      await finishQueuedAction(
        "Queued offline. Homi will synchronize it after reconnecting.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The item could not be queued.",
      );
    }
  }

  async function updateItem(
    item: StarterItemSnapshot,
  ): Promise<void> {
    try {
      await actions.enqueueMutation({
        entityType: "item",
        entityId: item.id,
        operation: "update",
        baseRevision: item.revision,
        payload: {
          title: `${item.title} updated`,
        },
      });
      await finishQueuedAction(
        "Update queued offline.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The update could not be queued.",
      );
    }
  }

  async function deleteItem(
    item: StarterItemSnapshot,
  ): Promise<void> {
    try {
      await actions.enqueueMutation({
        entityType: "item",
        entityId: item.id,
        operation: "delete",
        baseRevision: item.revision,
        payload: {},
      });
      await finishQueuedAction(
        "Delete queued offline.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The delete could not be queued.",
      );
    }
  }

  return (
    <section>
      <ModuleHeader
        eyebrow="Starter"
        title="My Homi module"
        description="This proof module uses only the public Homi module SDK, shared UI, and host-owned offline queue/cache."
      />

      <Surface padding="normal">
        <form onSubmit={(event) => void createItem(event)}>
          <FormField
            label="New item"
            htmlFor="starter-new-item"
            hint="Create while online or offline."
          >
            <TextField
              id="starter-new-item"
              value={title}
              onChange={(event) =>
                setTitle(event.currentTarget.value)
              }
              maxLength={160}
            />
          </FormField>
          <Button type="submit">Add item</Button>
        </form>

        {message && <p>{message}</p>}

        <div>
          {items.length === 0 ? (
            <p>No synchronized Starter items yet.</p>
          ) : (
            items.map((item) => (
              <Surface
                as="article"
                padding="compact"
                key={item.id}
              >
                <strong>{item.title}</strong>
                <p>Revision {item.revision}</p>
                <Button
                  variant="quiet"
                  onClick={() => void updateItem(item)}
                >
                  Update
                </Button>
                <Button
                  variant="quiet"
                  onClick={() => void deleteItem(item)}
                >
                  Delete
                </Button>
              </Surface>
            ))
          )}
        </div>
      </Surface>
    </section>
  );
}

function StarterModuleSetup({
  context,
  actions,
}: HomiWebModuleSurfaceProps) {
  const [boardLabel, setBoardLabel] =
    useState("Family notes");
  const [message, setMessage] = useState<string | null>(
    null,
  );

  async function handleSave(): Promise<void> {
    if (!context.online) {
      setMessage(
        "Reconnect to save required module setup.",
      );
      return;
    }

    try {
      const saved = await saveSetup(
        context,
        boardLabel.trim(),
      );
      setBoardLabel(saved.boardLabel);
      setMessage("Setup saved.");
      await actions.refreshModuleState();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Setup could not be saved.",
      );
    }
  }

  return (
    <SetupLayout
      title="Set up Starter"
      description="Required setup remains module-owned and persisted in mod_starter."
      actions={
        <Button onClick={() => void handleSave()}>
          Save setup
        </Button>
      }
    >
      <FormField
        label="Board label"
        htmlFor="starter-board-label"
      >
        <TextField
          id="starter-board-label"
          value={boardLabel}
          onChange={(event) =>
            setBoardLabel(event.currentTarget.value)
          }
          maxLength={80}
          disabled={!context.online}
        />
      </FormField>
      {message && <p>{message}</p>}
    </SetupLayout>
  );
}

function StarterModuleSettings({
  context,
  actions,
}: HomiWebModuleSurfaceProps) {
  const [boardLabel, setBoardLabel] = useState("");
  const [message, setMessage] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!context.online) return;
    void loadSetup(context)
      .then((setup) => {
        if (setup) setBoardLabel(setup.boardLabel);
      })
      .catch((error: unknown) => {
        setMessage(
          error instanceof Error
            ? error.message
            : "Settings could not be loaded.",
        );
      });
  }, [context.householdId, context.online]);

  async function handleSave(): Promise<void> {
    if (!context.online) {
      setMessage("Reconnect to change settings.");
      return;
    }
    try {
      const saved = await saveSetup(
        context,
        boardLabel.trim(),
      );
      setBoardLabel(saved.boardLabel);
      setMessage("Settings saved.");
      await actions.refreshModuleState();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Settings could not be saved.",
      );
    }
  }

  return (
    <section>
      <ModuleHeader
        eyebrow="Starter"
        title="Starter settings"
        description="These settings are stored by the module, not by Homi Core."
      />
      <Surface padding="normal">
        <FormField
          label="Board label"
          htmlFor="starter-settings-board-label"
        >
          <TextField
            id="starter-settings-board-label"
            value={boardLabel}
            onChange={(event) =>
              setBoardLabel(event.currentTarget.value)
            }
            maxLength={80}
            disabled={!context.online}
          />
        </FormField>
        <Button
          onClick={() => void handleSave()}
          disabled={!context.online}
        >
          Save settings
        </Button>
        {message && <p>{message}</p>}
      </Surface>
    </section>
  );
}

function StarterBoardSurface({
  actions,
}: HomiWebModuleSurfaceProps) {
  const [items, setItems] = useState<
    readonly StarterItemSnapshot[]
  >([]);

  useEffect(() => {
    void loadCachedItems(actions).then(setItems);
  }, []);

  return (
    <div>
      {items.length === 0 ? (
        <p>Starter is ready. Add an item from its page.</p>
      ) : (
        <>
          <strong>Starter notes</strong>
          <ul>
            {items.slice(0, 4).map((item) => (
              <li key={item.id}>{item.title}</li>
            ))}
          </ul>
        </>
      )}
      <Button
        variant="quiet"
        onClick={() =>
          actions.navigate("/modules/starter")
        }
      >
        Open Starter
      </Button>
    </div>
  );
}

export function createHomiWebModule(
  _context: HomiWebModuleHostContext,
) {
  return defineHomiWebModule({
    moduleKey: STARTER_MODULE_KEY,
    moduleApiVersion: HOMI_MODULE_API_VERSION,
    pages: {
      starter: StarterModulePage,
    },
    setup: StarterModuleSetup,
    settings: {
      household: StarterModuleSettings,
    },
    familyBoard: {
      "starter-board": StarterBoardSurface,
    },
    sync: {
      mutationAdapters: [
        starterItemMutationAdapter,
      ],
      changeHandlers: [
        starterItemChangeHandler,
      ],
    },
  });
}
