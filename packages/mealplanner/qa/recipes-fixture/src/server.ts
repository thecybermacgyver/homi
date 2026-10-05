// Test-only stand-in for a Recipes module: answers the same broker capability
// (`recipes.lookup.v1`) a real Recipes module will provide, with invented recipes.
import {
  HOMI_MODULE_API_VERSION,
  defineHomiServerModule,
  type HomiServerModuleHostContext,
} from "@homi/module-sdk";

const RECIPES = [
  { id: "fixture-fajitas", title: "Chicken fajitas", servings: 4, minutes: 35 },
  { id: "fixture-lentil", title: "Lentil soup", servings: 6, minutes: 50 },
  { id: "fixture-lasagna", title: "Veggie lasagna", servings: 8, minutes: 75 },
];

export function createHomiServerModule(_host: HomiServerModuleHostContext) {
  return defineHomiServerModule({
    moduleKey: "recipesfixture",
    moduleApiVersion: HOMI_MODULE_API_VERSION,
    register() {
      // No HTTP routes: the module only answers the broker.
    },
    sync: {
      mutationHandlers: [{
        entityType: "recipe",
        operations: ["create"],
        apply: async () => ({ status: "rejected", revision: null, errorCode: "FIXTURE_READ_ONLY", serverState: null }),
      }],
    },
    broker: {
      providers: [{
        capability: "recipes.lookup.v1",
        async handle(_context, invocation) {
          const payload = (invocation.payload ?? {}) as Record<string, unknown>;
          if (invocation.action === "search") {
            const query = String(payload.query ?? "").toLocaleLowerCase();
            return RECIPES.filter((r) => r.title.toLocaleLowerCase().includes(query));
          }
          if (invocation.action === "get") return RECIPES.find((r) => r.id === payload.id) ?? null;
          throw Object.assign(new Error("Unsupported recipe action."), { statusCode: 400, code: "RECIPES_ACTION_UNSUPPORTED" });
        },
      }],
    },
  });
}
