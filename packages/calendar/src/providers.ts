import {
  createHash,
  randomBytes,
} from "node:crypto";
import { XMLParser } from "fast-xml-parser";

export type CalendarExternalProvider =
  | "google"
  | "apple"
  | "outlook";

export interface CalendarExternalEvent {
  readonly remoteId: string;
  readonly etag: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly allDay: boolean;
  readonly timeZone: string;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly startDate: string | null;
  readonly endDateExclusive: string | null;
  readonly location: string | null;
  readonly remoteUpdatedAt: string | null;
  readonly cancelled: boolean;
}

export interface CalendarOAuthRequest {
  readonly state: string;
  readonly stateHash: string;
  readonly codeVerifier: string;
  readonly authorizationUrl: string;
}

export interface CalendarOAuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresIn: number | null;
}

export interface AppleCalendarDiscovery {
  readonly href: string;
  readonly displayName: string;
}

interface ProviderConnection {
  readonly provider: CalendarExternalProvider;
  readonly remoteCalendarId: string;
  readonly endpointUrl: string | null;
}

interface FetchEventsInput {
  readonly connection: ProviderConnection;
  readonly secret: string;
  readonly rangeStart: string;
  readonly rangeEnd: string;
}

function env(name: string): string | null {
  const value = process.env[name];
  return value?.trim() ? value.trim() : null;
}

function oauthClient(provider: "google" | "outlook"): {
  clientId: string;
  clientSecret: string;
} | null {
  const prefix =
    provider === "google"
      ? "HOMI_CALENDAR_GOOGLE"
      : "HOMI_CALENDAR_OUTLOOK";
  const clientId = env(`${prefix}_CLIENT_ID`);
  const clientSecret = env(`${prefix}_CLIENT_SECRET`);
  return clientId && clientSecret
    ? { clientId, clientSecret }
    : null;
}

export function providerConfigured(
  provider: CalendarExternalProvider,
): boolean {
  return provider === "apple"
    ? true
    : oauthClient(provider) !== null;
}

function base64url(value: Buffer): string {
  return value.toString("base64url");
}

export function createOAuthRequest(
  provider: "google" | "outlook",
  redirectUri: string,
): CalendarOAuthRequest {
  const client = oauthClient(provider);
  if (!client) {
    throw new Error(
      `${provider} Calendar OAuth is not configured on this Homi server.`,
    );
  }
  const state = base64url(randomBytes(32));
  const codeVerifier = base64url(randomBytes(48));
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  const url =
    provider === "google"
      ? new URL("https://accounts.google.com/o/oauth2/v2/auth")
      : new URL(
          "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        );
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  if (provider === "google") {
    url.searchParams.set(
      "scope",
      "https://www.googleapis.com/auth/calendar.events.readonly",
    );
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  } else {
    url.searchParams.set(
      "scope",
      "offline_access Calendars.Read",
    );
    url.searchParams.set("response_mode", "query");
  }

  return Object.freeze({
    state,
    stateHash: createHash("sha256")
      .update(state)
      .digest("hex"),
    codeVerifier,
    authorizationUrl: url.toString(),
  });
}

async function formTokenRequest(
  url: string,
  form: URLSearchParams,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const body = (await response.json()) as unknown;
  if (
    !response.ok ||
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    throw new Error(
      `Calendar provider token exchange failed with HTTP ${response.status}.`,
    );
  }
  const record = body as Record<string, unknown>;
  if (typeof record.access_token !== "string") {
    const description =
      typeof record.error_description === "string"
        ? record.error_description
        : typeof record.error === "string"
          ? record.error
          : "Provider did not return an access token.";
    throw new Error(description);
  }
  return record;
}

export async function exchangeOAuthCode(
  provider: "google" | "outlook",
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<CalendarOAuthTokens> {
  const client = oauthClient(provider);
  if (!client) {
    throw new Error(
      `${provider} Calendar OAuth is not configured on this Homi server.`,
    );
  }
  const form = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const body = await formTokenRequest(
    provider === "google"
      ? "https://oauth2.googleapis.com/token"
      : "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    form,
  );
  return Object.freeze({
    accessToken: String(body.access_token),
    refreshToken:
      typeof body.refresh_token === "string"
        ? body.refresh_token
        : null,
    expiresIn:
      typeof body.expires_in === "number"
        ? body.expires_in
        : null,
  });
}

export async function refreshOAuthAccessToken(
  provider: "google" | "outlook",
  refreshToken: string,
): Promise<CalendarOAuthTokens> {
  const client = oauthClient(provider);
  if (!client) {
    throw new Error(
      `${provider} Calendar OAuth is not configured on this Homi server.`,
    );
  }
  const form = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  if (provider === "outlook") {
    form.set("scope", "offline_access Calendars.Read");
  }
  const body = await formTokenRequest(
    provider === "google"
      ? "https://oauth2.googleapis.com/token"
      : "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    form,
  );
  return Object.freeze({
    accessToken: String(body.access_token),
    refreshToken:
      typeof body.refresh_token === "string"
        ? body.refresh_token
        : null,
    expiresIn:
      typeof body.expires_in === "number"
        ? body.expires_in
        : null,
  });
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function iso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toISOString()
    : null;
}

async function googleEvents(
  accessToken: string,
  remoteCalendarId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<readonly CalendarExternalEvent[]> {
  const events: CalendarExternalEvent[] = [];
  let pageToken: string | null = null;

  do {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        remoteCalendarId,
      )}/events`,
    );
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("maxResults", "2500");
    url.searchParams.set("timeMin", rangeStart);
    url.searchParams.set("timeMax", rangeEnd);
    url.searchParams.set("orderBy", "startTime");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = (await response.json()) as unknown;
    if (
      !response.ok ||
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      throw new Error(
        `Google Calendar event sync failed with HTTP ${response.status}.`,
      );
    }
    const record = body as Record<string, unknown>;
    const items = Array.isArray(record.items)
      ? record.items
      : [];

    for (const raw of items) {
      if (
        typeof raw !== "object" ||
        raw === null ||
        Array.isArray(raw)
      ) {
        continue;
      }
      const item = raw as Record<string, unknown>;
      if (typeof item.id !== "string") continue;
      const start =
        typeof item.start === "object" &&
        item.start !== null &&
        !Array.isArray(item.start)
          ? (item.start as Record<string, unknown>)
          : {};
      const end =
        typeof item.end === "object" &&
        item.end !== null &&
        !Array.isArray(item.end)
          ? (item.end as Record<string, unknown>)
          : {};
      const startDate = optionalText(start.date);
      const endDate = optionalText(end.date);
      const startInstant = iso(start.dateTime);
      const endInstant = iso(end.dateTime);
      const allDay = startDate !== null && endDate !== null;
      if (
        !allDay &&
        (startInstant === null || endInstant === null)
      ) {
        continue;
      }

      events.push(
        Object.freeze({
          remoteId: item.id,
          etag: optionalText(item.etag),
          title: optionalText(item.summary) ?? "(Untitled event)",
          description: optionalText(item.description),
          allDay,
          timeZone:
            optionalText(start.timeZone) ??
            optionalText(end.timeZone) ??
            "UTC",
          startsAt: allDay ? null : startInstant,
          endsAt: allDay ? null : endInstant,
          startDate,
          endDateExclusive: endDate,
          location: optionalText(item.location),
          remoteUpdatedAt: iso(item.updated),
          cancelled: item.status === "cancelled",
        }),
      );
    }
    pageToken =
      typeof record.nextPageToken === "string"
        ? record.nextPageToken
        : null;
  } while (pageToken);

  return Object.freeze(events);
}

function graphInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized =
    /(?:Z|[+-]\d\d:\d\d)$/.test(value)
      ? value
      : `${value}Z`;
  return iso(normalized);
}

async function outlookEvents(
  accessToken: string,
  remoteCalendarId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<readonly CalendarExternalEvent[]> {
  const events: CalendarExternalEvent[] = [];
  let nextUrl: string | null = (() => {
    const path =
      remoteCalendarId === "default"
        ? "/v1.0/me/calendar/calendarView"
        : `/v1.0/me/calendars/${encodeURIComponent(
            remoteCalendarId,
          )}/calendarView`;
    const url = new URL(
      `https://graph.microsoft.com${path}`,
    );
    url.searchParams.set("startDateTime", rangeStart);
    url.searchParams.set("endDateTime", rangeEnd);
    url.searchParams.set("$top", "1000");
    return url.toString();
  })();

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"',
      },
    });
    const body = (await response.json()) as unknown;
    if (
      !response.ok ||
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      throw new Error(
        `Outlook Calendar event sync failed with HTTP ${response.status}.`,
      );
    }
    const record = body as Record<string, unknown>;
    const items = Array.isArray(record.value)
      ? record.value
      : [];

    for (const raw of items) {
      if (
        typeof raw !== "object" ||
        raw === null ||
        Array.isArray(raw)
      ) {
        continue;
      }
      const item = raw as Record<string, unknown>;
      if (typeof item.id !== "string") continue;
      const start =
        typeof item.start === "object" &&
        item.start !== null &&
        !Array.isArray(item.start)
          ? (item.start as Record<string, unknown>)
          : {};
      const end =
        typeof item.end === "object" &&
        item.end !== null &&
        !Array.isArray(item.end)
          ? (item.end as Record<string, unknown>)
          : {};
      const startsAt = graphInstant(start.dateTime);
      const endsAt = graphInstant(end.dateTime);
      if (startsAt === null || endsAt === null) continue;
      const allDay = item.isAllDay === true;
      const bodyText =
        typeof item.body === "object" &&
        item.body !== null &&
        !Array.isArray(item.body)
          ? optionalText(
              (item.body as Record<string, unknown>).content,
            )
          : null;
      events.push(
        Object.freeze({
          remoteId: item.id,
          etag: optionalText(item["@odata.etag"]),
          title: optionalText(item.subject) ?? "(Untitled event)",
          description: bodyText,
          allDay,
          timeZone: "UTC",
          startsAt: allDay ? null : startsAt,
          endsAt: allDay ? null : endsAt,
          startDate: allDay
            ? startsAt.slice(0, 10)
            : null,
          endDateExclusive: allDay
            ? endsAt.slice(0, 10)
            : null,
          location:
            typeof item.location === "object" &&
            item.location !== null &&
            !Array.isArray(item.location)
              ? optionalText(
                  (item.location as Record<string, unknown>)
                    .displayName,
                )
              : null,
          remoteUpdatedAt: iso(item.lastModifiedDateTime),
          cancelled: item.isCancelled === true,
        }),
      );
    }
    nextUrl =
      typeof record["@odata.nextLink"] === "string"
        ? record["@odata.nextLink"]
        : null;
  }

  return Object.freeze(events);
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(
    `${username}:${password}`,
    "utf8",
  ).toString("base64")}`;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
});

function asArray<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) return [];
  return Array.isArray(value)
    ? value
    : [value] as readonly T[];
}

function propResponses(xml: string): readonly Record<string, unknown>[] {
  const parsed = xmlParser.parse(xml) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return [];
  }
  const multistatus = (parsed as Record<string, unknown>)
    .multistatus;
  if (
    typeof multistatus !== "object" ||
    multistatus === null ||
    Array.isArray(multistatus)
  ) {
    return [];
  }
  return asArray(
    (multistatus as Record<string, unknown>).response,
  ).filter(
    (value): value is Record<string, unknown> =>
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value),
  );
}

function responseProp(
  response: Record<string, unknown>,
): Record<string, unknown> {
  for (const raw of asArray(response.propstat)) {
    if (
      typeof raw !== "object" ||
      raw === null ||
      Array.isArray(raw)
    ) {
      continue;
    }
    const prop = (raw as Record<string, unknown>).prop;
    if (
      typeof prop === "object" &&
      prop !== null &&
      !Array.isArray(prop)
    ) {
      return prop as Record<string, unknown>;
    }
  }
  return {};
}

function nestedHref(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const href = (value as Record<string, unknown>).href;
    return typeof href === "string" ? href : null;
  }
  return null;
}

function trustedAppleCaldavUrl(
  value: string,
  base?: string,
): URL {
  let url: URL;
  try {
    url = base === undefined
      ? new URL(value)
      : new URL(value, base);
  } catch {
    throw new Error("Apple CalDAV returned an invalid URL.");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    url.username !== "" ||
    url.password !== "" ||
    !(
      hostname === "caldav.icloud.com" ||
      hostname.endsWith(".caldav.icloud.com")
    )
  ) {
    throw new Error(
      "Apple CalDAV URLs must use a trusted iCloud CalDAV host.",
    );
  }

  return url;
}

async function caldavRequest(
  url: string,
  username: string,
  password: string,
  method: "PROPFIND" | "REPORT",
  body: string,
  depth: "0" | "1",
): Promise<string> {
  let currentUrl = trustedAppleCaldavUrl(url);

  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(currentUrl, {
      method,
      headers: {
        Authorization: basicAuth(username, password),
        "Content-Type": "application/xml; charset=utf-8",
        Depth: depth,
      },
      body,
      redirect: "manual",
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === 5) {
        throw new Error("Apple CalDAV redirect validation failed.");
      }
      currentUrl = trustedAppleCaldavUrl(
        location,
        currentUrl.toString(),
      );
      continue;
    }

    const text = await response.text();
    if (!response.ok && response.status !== 207) {
      throw new Error(
        `Apple CalDAV request failed with HTTP ${response.status}.`,
      );
    }
    return text;
  }

  throw new Error("Apple CalDAV exceeded the redirect limit.");
}

export async function discoverAppleCalendars(
  username: string,
  password: string,
  endpointUrl = "https://caldav.icloud.com/",
): Promise<readonly AppleCalendarDiscovery[]> {
  const principalXml = await caldavRequest(
    endpointUrl,
    username,
    password,
    "PROPFIND",
    `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:current-user-principal /></d:prop>
</d:propfind>`,
    "0",
  );
  const principalResponse = propResponses(principalXml)[0];
  const principalHref = principalResponse
    ? nestedHref(
        responseProp(principalResponse)[
          "current-user-principal"
        ],
      )
    : null;
  if (!principalHref) {
    throw new Error(
      "Apple CalDAV did not return a current-user principal.",
    );
  }
  const principalUrl = new URL(
    principalHref,
    endpointUrl,
  ).toString();

  const homeXml = await caldavRequest(
    principalUrl,
    username,
    password,
    "PROPFIND",
    `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-home-set /></d:prop>
</d:propfind>`,
    "0",
  );
  const homeResponse = propResponses(homeXml)[0];
  const homeHref = homeResponse
    ? nestedHref(
        responseProp(homeResponse)["calendar-home-set"],
      )
    : null;
  if (!homeHref) {
    throw new Error(
      "Apple CalDAV did not return a calendar home.",
    );
  }
  const homeUrl = new URL(homeHref, principalUrl).toString();

  const calendarsXml = await caldavRequest(
    homeUrl,
    username,
    password,
    "PROPFIND",
    `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
  </d:prop>
</d:propfind>`,
    "1",
  );

  const calendars: AppleCalendarDiscovery[] = [];
  for (const response of propResponses(calendarsXml)) {
    const prop = responseProp(response);
    const resourceType = prop.resourcetype;
    if (
      typeof resourceType !== "object" ||
      resourceType === null ||
      Array.isArray(resourceType) ||
      !Object.hasOwn(
        resourceType as Record<string, unknown>,
        "calendar",
      )
    ) {
      continue;
    }
    const href =
      typeof response.href === "string"
        ? response.href
        : null;
    if (!href) continue;
    calendars.push(
      Object.freeze({
        href: new URL(href, homeUrl).toString(),
        displayName:
          optionalText(prop.displayname) ??
          "Apple Calendar",
      }),
    );
  }
  return Object.freeze(calendars);
}

function unfoldIcs(value: string): string[] {
  return value
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/);
}

function unescapeIcs(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseIcsDateTime(
  name: string,
  rawValue: string,
): {
  allDay: boolean;
  date: string | null;
  instant: string | null;
  timeZone: string;
} | null {
  const [property, ...params] = name.split(";");
  void property;
  const parameterMap = new Map<string, string>();
  for (const param of params) {
    const index = param.indexOf("=");
    if (index > 0) {
      parameterMap.set(
        param.slice(0, index).toUpperCase(),
        param.slice(index + 1),
      );
    }
  }
  if (
    parameterMap.get("VALUE") === "DATE" ||
    /^\d{8}$/.test(rawValue)
  ) {
    if (!/^\d{8}$/.test(rawValue)) return null;
    return {
      allDay: true,
      date: `${rawValue.slice(0, 4)}-${rawValue.slice(
        4,
        6,
      )}-${rawValue.slice(6, 8)}`,
      instant: null,
      timeZone: parameterMap.get("TZID") ?? "UTC",
    };
  }

  const match =
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(
      rawValue,
    );
  if (!match) return null;
  const isoLocal =
    `${match[1]}-${match[2]}-${match[3]}T` +
    `${match[4]}:${match[5]}:${match[6]}`;
  const timeZone = parameterMap.get("TZID") ?? "UTC";
  const instant = match[7]
    ? new Date(`${isoLocal}Z`).toISOString()
    : wallTimeToIso(
        `${match[1]}-${match[2]}-${match[3]}`,
        `${match[4]}:${match[5]}`,
        timeZone,
      );
  return {
    allDay: false,
    date: null,
    instant,
    timeZone,
  };
}

function wallTimeToIso(
  date: string,
  time: string,
  timeZone: string,
): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(
    year!,
    month! - 1,
    day!,
    hour!,
    minute!,
  );
  let guess = desired;
  for (let index = 0; index < 4; index += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    const observed = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
    );
    const correction = desired - observed;
    if (correction === 0) break;
    guess += correction;
  }
  return new Date(guess).toISOString();
}

function parseExpandedIcs(
  ics: string,
  etag: string | null,
): readonly CalendarExternalEvent[] {
  const lines = unfoldIcs(ics);
  const result: CalendarExternalEvent[] = [];
  let current: Map<string, string> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = new Map();
      continue;
    }
    if (line === "END:VEVENT") {
      if (!current) continue;
      const uid = current.get("UID");
      const startEntry = [...current.entries()].find(
        ([key]) => key.split(";")[0] === "DTSTART",
      );
      const endEntry = [...current.entries()].find(
        ([key]) => key.split(";")[0] === "DTEND",
      );
      const recurrenceIdEntry = [...current.entries()].find(
        ([key]) => key.split(";")[0] === "RECURRENCE-ID",
      );
      if (uid && startEntry && endEntry) {
        const start = parseIcsDateTime(
          startEntry[0],
          startEntry[1],
        );
        const end = parseIcsDateTime(
          endEntry[0],
          endEntry[1],
        );
        if (start && end && start.allDay === end.allDay) {
          const recurrenceKey = recurrenceIdEntry
            ? `:${recurrenceIdEntry[1]}`
            : "";
          result.push(
            Object.freeze({
              remoteId: `${uid}${recurrenceKey}`,
              etag,
              title:
                unescapeIcs(
                  current.get("SUMMARY") ?? "",
                ) || "(Untitled event)",
              description: optionalText(
                current.get("DESCRIPTION"),
              ),
              allDay: start.allDay,
              timeZone: start.timeZone,
              startsAt: start.instant,
              endsAt: end.instant,
              startDate: start.date,
              endDateExclusive: end.date,
              location: optionalText(
                current.get("LOCATION"),
              ),
              remoteUpdatedAt: (() => {
                const stamp = current.get("LAST-MODIFIED");
                if (!stamp) return null;
                const parsed = parseIcsDateTime(
                  "LAST-MODIFIED",
                  stamp,
                );
                return parsed?.instant ?? null;
              })(),
              cancelled:
                current.get("STATUS") === "CANCELLED",
            }),
          );
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    current.set(
      line.slice(0, separator).toUpperCase(),
      line.slice(separator + 1),
    );
  }
  return Object.freeze(result);
}

async function appleEvents(
  username: string,
  password: string,
  calendarUrl: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<readonly CalendarExternalEvent[]> {
  const compact = (value: string) =>
    value.replace(/[-:]/g, "").replace(/\.000Z$/, "Z");
  const xml = await caldavRequest(
    calendarUrl,
    username,
    password,
    "REPORT",
    `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data>
      <c:expand start="${compact(rangeStart)}" end="${compact(rangeEnd)}" />
    </c:calendar-data>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${compact(rangeStart)}" end="${compact(rangeEnd)}" />
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`,
    "1",
  );
  const events: CalendarExternalEvent[] = [];
  for (const response of propResponses(xml)) {
    const prop = responseProp(response);
    const calendarData = prop["calendar-data"];
    if (typeof calendarData !== "string") continue;
    const etag = optionalText(prop.getetag);
    events.push(...parseExpandedIcs(calendarData, etag));
  }
  return Object.freeze(events);
}

export async function fetchExternalEvents(
  input: FetchEventsInput,
): Promise<{
  readonly events: readonly CalendarExternalEvent[];
  readonly replacementSecret: string | null;
}> {
  const { connection, secret, rangeStart, rangeEnd } =
    input;

  if (connection.provider === "apple") {
    const credentials = JSON.parse(secret) as unknown;
    if (
      typeof credentials !== "object" ||
      credentials === null ||
      Array.isArray(credentials) ||
      typeof (credentials as Record<string, unknown>)
        .username !== "string" ||
      typeof (credentials as Record<string, unknown>)
        .password !== "string"
    ) {
      throw new Error(
        "Stored Apple Calendar credentials are invalid.",
      );
    }
    const record = credentials as {
      username: string;
      password: string;
    };
    return {
      events: await appleEvents(
        record.username,
        record.password,
        connection.remoteCalendarId,
        rangeStart,
        rangeEnd,
      ),
      replacementSecret: null,
    };
  }

  const refreshed = await refreshOAuthAccessToken(
    connection.provider,
    secret,
  );
  return {
    events: connection.provider === "google"
      ? await googleEvents(
          refreshed.accessToken,
          connection.remoteCalendarId,
          rangeStart,
          rangeEnd,
        )
      : await outlookEvents(
          refreshed.accessToken,
          connection.remoteCalendarId,
          rangeStart,
          rangeEnd,
        ),
    replacementSecret: refreshed.refreshToken,
  };
}
