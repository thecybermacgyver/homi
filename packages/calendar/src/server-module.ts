import type { FastifyInstance } from "fastify";
import type { HomiDatabase } from "@homi/db";
import {
  HOMI_MODULE_API_VERSION,
  defineHomiServerModule,
  type HomiRequestContext,
} from "@homi/module-sdk";
import { registerCalendarRoutes } from "./routes.js";
import { createCalendarService } from "./service.js";
import {
  HOMI_CALENDAR_MODULE_KEY,
} from "./types.js";

export interface CalendarServerModuleHostContext {
  readonly database: HomiDatabase["db"];
  resolveContext(request: {
    id: string;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<HomiRequestContext>;
}

export function createHomiServerModule(
  context: CalendarServerModuleHostContext,
) {
  const calendar = createCalendarService(context.database);

  return defineHomiServerModule({
    moduleKey: HOMI_CALENDAR_MODULE_KEY,
    moduleApiVersion: HOMI_MODULE_API_VERSION,
    register(app: FastifyInstance) {
      registerCalendarRoutes(app, {
        calendar,
        resolveContext: context.resolveContext,
      });
    },
  });
}
