import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  HOMI_MODULE_API_VERSION,
  defineHomiWebModule,
  type HomiHouseholdPerson,
  type HomiWebModuleHostContext,
  type HomiWebModuleSurfaceProps,
} from "@homi/module-sdk";
import {
  BottomSheet,
  Button,
  Checkbox,
  EmptyState,
  FormField,
  ModuleHeader,
  SearchField,
  Select,
  Surface,
  TextField,
} from "@homi/ui";
import { SHOPPING_MODULE_KEY, inferAisle } from "./constants.js";
import {
  parseShoppingItem,
  shoppingItemChangeHandler,
  shoppingItemMutationAdapter,
} from "./sync.js";
import type { ShoppingItem } from "./types.js";

interface Editor {
  name: string;
  quantity: string;
  store: string;
  aisle: string;
  assignedTo: string;
}

function headers(context: HomiWebModuleHostContext): Record<string, string> {
  return {
    "X-Homi-Household-ID": context.householdId,
    "X-Homi-Client-ID": context.clientId,
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function apiData<T>(
  context: HomiWebModuleHostContext,
  path: string,
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: headers(context),
  });
  const raw = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error("Shopping returned an invalid response.");
  }
  if (!response.ok) {
    if (
      object(body) &&
      object(body.error) &&
      typeof body.error.message === "string"
    ) {
      throw new Error(body.error.message);
    }
    throw new Error("Shopping could not load this information.");
  }
  if (!object(body) || !Object.hasOwn(body, "data")) {
    throw new Error("Shopping response shape is invalid.");
  }
  return body.data as T;
}

async function cachedItems(
  actions: HomiWebModuleSurfaceProps["actions"],
): Promise<readonly ShoppingItem[]> {
  const values = await actions.listCachedEntities("item");
  return Object.freeze(
    values
      .map((record) => {
        try {
          const item = parseShoppingItem(record.data);
          return item.deleted ? null : item;
        } catch {
          return null;
        }
      })
      .filter((item): item is ShoppingItem => item !== null),
  );
}

async function seedItems(
  actions: HomiWebModuleSurfaceProps["actions"],
  items: readonly ShoppingItem[],
): Promise<void> {
  await actions.replaceCachedEntities(
    "item",
    items.map((item) => ({
      entityId: item.id,
      revision: item.revision,
      data: item,
    })),
  );
}

function itemPayload(item: ShoppingItem, checked = item.checked) {
  return {
    name: item.name,
    quantity: item.quantity,
    store: item.store,
    aisle: item.aisle,
    assignedTo: item.assignedTo,
    checked,
  };
}

function ShoppingPage({
  context,
  actions,
}: HomiWebModuleSurfaceProps) {
  const [items, setItems] = useState<readonly ShoppingItem[]>([]);
  const [people, setPeople] = useState<readonly HomiHouseholdPerson[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showChecked, setShowChecked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const reloadCached = useCallback(async () => {
    setItems(await cachedItems(actionsRef.current));
  }, []);

  const refreshOnline = useCallback(async () => {
    if (!context.online) return;
    const [nextItems, nextPeople] = await Promise.all([
      apiData<readonly unknown[]>(context, "/api/v1/modules/shopping/items"),
      apiData<readonly HomiHouseholdPerson[]>(context, "/api/v1/modules/shopping/people"),
    ]);
    const parsed = nextItems.map(parseShoppingItem);
    await seedItems(actionsRef.current, parsed);
    setItems(parsed);
    setPeople(nextPeople);
  }, [context.householdId, context.clientId, context.online]);

  useEffect(() => {
    void reloadCached()
      .then(refreshOnline)
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "Shopping could not be loaded.");
      });
  }, [reloadCached, refreshOnline]);

  const latest = useRef({ setEditor, setSearchOpen });
  latest.current = { setEditor, setSearchOpen };
  useEffect(() => {
    actions.registerContextActions({
      search: {
        label: "Search Shopping List",
        invoke: () => latest.current.setSearchOpen((value) => !value),
      },
      create: {
        label: "Add shopping item",
        invoke: () => latest.current.setEditor({
          name: "",
          quantity: "1",
          store: "Any store",
          aisle: "Automatic",
          assignedTo: "",
        }),
      },
    });
    return () => actions.registerContextActions(null);
  }, [actions]);

  async function finish(offlineMessage: string): Promise<void> {
    if (context.online) {
      await actions.syncNow();
      await refreshOnline();
      setMessage("Shopping List synchronized.");
    } else {
      await reloadCached();
      setMessage(offlineMessage);
    }
  }

  async function addItem(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editor || !editor.name.trim()) return;
    const name = editor.name.trim();
    try {
      await actions.enqueueMutation({
        entityType: "item",
        entityId: crypto.randomUUID(),
        operation: "create",
        baseRevision: "0",
        payload: {
          name,
          quantity: editor.quantity.trim() || "1",
          store: editor.store.trim() || "Any store",
          aisle: editor.aisle === "Automatic" ? inferAisle(name) : editor.aisle,
          assignedTo: editor.assignedTo || null,
          checked: false,
        },
      });
      setEditor(null);
      await finish("Item saved offline. Homi will share it after reconnecting.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The item could not be added.");
    }
  }

  async function toggleItem(item: ShoppingItem): Promise<void> {
    try {
      await actions.enqueueMutation({
        entityType: "item",
        entityId: item.id,
        operation: "update",
        baseRevision: item.revision,
        payload: itemPayload(item, !item.checked),
      });
      await finish(
        item.checked
          ? "The item was returned to the list offline."
          : "The item was checked off offline.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The item could not be changed.");
    }
  }

  async function deleteItem(item: ShoppingItem): Promise<void> {
    try {
      await actions.enqueueMutation({
        entityType: "item",
        entityId: item.id,
        operation: "delete",
        baseRevision: item.revision,
        payload: {},
      });
      await finish("The item was removed offline.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The item could not be removed.");
    }
  }

  const personById = useMemo(
    () => new Map(people.map((person) => [person.id, person.displayName])),
    [people],
  );
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (!showChecked && item.checked) return false;
      if (!query) return true;
      return [item.name, item.store, item.aisle, personById.get(item.assignedTo ?? "") ?? ""]
        .some((value) => value.toLocaleLowerCase().includes(query));
    });
  }, [items, personById, search, showChecked]);

  const groups = useMemo(() => {
    const result = new Map<string, Map<string, ShoppingItem[]>>();
    for (const item of visible) {
      const aisles = result.get(item.store) ?? new Map<string, ShoppingItem[]>();
      const aisleItems = aisles.get(item.aisle) ?? [];
      aisleItems.push(item);
      aisles.set(item.aisle, aisleItems);
      result.set(item.store, aisles);
    }
    return result;
  }, [visible]);

  return (
    <section>
      <ModuleHeader
        eyebrow="Household"
        title="Shopping List"
        description="Shared in real time and arranged automatically by store and aisle."
      />

      {searchOpen && (
        <Surface padding="compact" role="search" aria-label="Search Shopping List">
          <SearchField
            id="shopping-search"
            label="Search Shopping List"
            placeholder="Item, store, aisle, or person"
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
          <Button variant="quiet" onClick={() => { setSearch(""); setSearchOpen(false); }}>
            Close
          </Button>
        </Surface>
      )}

      <Surface padding="compact">
        <Checkbox
          label="Show checked items"
          checked={showChecked}
          onChange={(event) => setShowChecked(event.currentTarget.checked)}
        />
        {message && <p aria-live="polite">{message}</p>}
      </Surface>

      {groups.size === 0 ? (
        <EmptyState
          title={items.length === 0 ? "Your Shopping List is empty" : "No matching items"}
          description={
            items.length === 0
              ? "Use the + button to add the first item."
              : "Change the search or show checked items."
          }
        />
      ) : (
        Array.from(groups, ([store, aisles]) => (
          <Surface as="section" padding="normal" key={store}>
            <h2>{store}</h2>
            {Array.from(aisles, ([aisle, aisleItems]) => (
              <section key={aisle}>
                <h3>{aisle}</h3>
                {aisleItems.map((item) => (
                  <Surface as="article" padding="compact" key={item.id}>
                    <Checkbox
                      label={`${item.quantity} ${item.name}`}
                      checked={item.checked}
                      onChange={() => void toggleItem(item)}
                    />
                    {item.assignedTo && (
                      <p>Assigned to {personById.get(item.assignedTo) ?? "Household member"}</p>
                    )}
                    <Button variant="quiet" onClick={() => void deleteItem(item)}>
                      Remove
                    </Button>
                  </Surface>
                ))}
              </section>
            ))}
          </Surface>
        ))
      )}

      <BottomSheet
        open={editor !== null}
        title="Add shopping item"
        onDismiss={() => setEditor(null)}
      >
        {editor && (
          <form onSubmit={(event) => void addItem(event)}>
            <FormField label="Item" htmlFor="shopping-name">
              <TextField
                id="shopping-name"
                required
                autoFocus
                maxLength={160}
                value={editor.name}
                onChange={(event) => setEditor({ ...editor, name: event.currentTarget.value })}
              />
            </FormField>
            <FormField label="Quantity" htmlFor="shopping-quantity">
              <TextField
                id="shopping-quantity"
                maxLength={40}
                value={editor.quantity}
                onChange={(event) => setEditor({ ...editor, quantity: event.currentTarget.value })}
              />
            </FormField>
            <FormField label="Store" htmlFor="shopping-store" hint="Items are grouped by store.">
              <TextField
                id="shopping-store"
                maxLength={100}
                value={editor.store}
                onChange={(event) => setEditor({ ...editor, store: event.currentTarget.value })}
              />
            </FormField>
            <FormField
              label="Aisle"
              htmlFor="shopping-aisle"
              hint="Automatic categorizes common household items."
            >
              <Select
                id="shopping-aisle"
                value={editor.aisle}
                onChange={(event) => setEditor({ ...editor, aisle: event.currentTarget.value })}
              >
                {["Automatic", "Produce", "Bakery", "Dairy & eggs", "Meat & seafood", "Frozen", "Pantry", "Household", "Pharmacy", "Hardware", "Other"]
                  .map((aisle) => <option key={aisle} value={aisle}>{aisle}</option>)}
              </Select>
            </FormField>
            <FormField label="Assign to" htmlFor="shopping-assignee">
              <Select
                id="shopping-assignee"
                value={editor.assignedTo}
                onChange={(event) => setEditor({ ...editor, assignedTo: event.currentTarget.value })}
              >
                <option value="">Anyone</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>{person.displayName}</option>
                ))}
              </Select>
            </FormField>
            <Button type="submit">Add item</Button>
          </form>
        )}
      </BottomSheet>
    </section>
  );
}

function ShoppingBoard({ context, actions }: HomiWebModuleSurfaceProps) {
  const [items, setItems] = useState<readonly ShoppingItem[]>([]);

  useEffect(() => {
    void cachedItems(actions).then(setItems);
  }, [actions, context.householdId]);

  const active = items.filter((item) => !item.checked);
  return (
    <div>
      <strong>Shopping List</strong>
      {active.length === 0 ? (
        <p>Nothing to pick up.</p>
      ) : (
        <ul>
          {active.slice(0, 8).map((item) => (
            <li key={item.id}>
              <Checkbox
                label={`${item.quantity} ${item.name}`}
                checked={false}
                onChange={async () => {
                  await actions.enqueueMutation({
                    entityType: "item",
                    entityId: item.id,
                    operation: "update",
                    baseRevision: item.revision,
                    payload: itemPayload(item, true),
                  });
                  if (context.online) await actions.syncNow();
                  setItems(await cachedItems(actions));
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {active.length > 8 && <p>+{active.length - 8} more</p>}
      <Button variant="quiet" onClick={() => actions.navigate("/modules/shopping")}>
        Open Shopping List
      </Button>
    </div>
  );
}

export function createHomiWebModule(_context: HomiWebModuleHostContext) {
  return defineHomiWebModule({
    moduleKey: SHOPPING_MODULE_KEY,
    moduleApiVersion: HOMI_MODULE_API_VERSION,
    pages: { shopping: ShoppingPage },
    familyBoard: { "shopping-list": ShoppingBoard },
    sync: {
      mutationAdapters: [shoppingItemMutationAdapter],
      changeHandlers: [shoppingItemChangeHandler],
    },
  });
}
