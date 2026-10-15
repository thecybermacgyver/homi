import { useCallback, useEffect, useRef, useState } from "react";
import { BottomSheet, Button, Notice } from "@homi/ui";

// A member's notifications: an inbox that shows what modules (Calendar
// reminders, for one) have sent, and an opt-in to receive each one on this
// device as a push notification, even when Homi is not open.

export interface NotificationItem {
  readonly id: string;
  readonly sourceModuleKey: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}

export type PushState =
  | "unsupported"
  | "blocked"
  | "off"
  | "on"
  | "working";

interface Identity {
  readonly householdId: string | null;
  readonly clientId: string | null;
  readonly online: boolean;
  readonly signedIn: boolean;
}

function headers(identity: Identity): Record<string, string> {
  return {
    "X-Homi-Household-ID": identity.householdId ?? "",
    "X-Homi-Client-ID": identity.clientId ?? "",
  };
}

async function call<T>(
  identity: Identity,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(path, {
    method: init?.method ?? "GET",
    credentials: "same-origin",
    headers: {
      ...headers(identity),
      ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Homi returned an unexpected response.");
  }
  if (!response.ok) {
    const message = (parsed as { error?: { message?: string } })?.error?.message;
    throw new Error(message ?? "The request could not be completed.");
  }
  return (parsed as { data: T }).data;
}

function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function toKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(base64Url.length / 4) * 4, "=");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function useNotifications(identity: Identity) {
  const [items, setItems] = useState<readonly NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [push, setPush] = useState<PushState>(
    pushSupported() ? "working" : "unsupported",
  );
  const latest = useRef(identity);
  latest.current = identity;
  const active = identity.signedIn && identity.householdId !== null &&
    identity.clientId !== null && identity.online;

  const refresh = useCallback(async () => {
    const id = latest.current;
    if (!(id.signedIn && id.householdId && id.clientId && id.online)) return;
    try {
      const data = await call<{ items: NotificationItem[]; unread: number }>(
        id, "/api/v1/core/notifications",
      );
      setItems(data.items);
      setUnread(data.unread);
      setFailure(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }, []);

  // Keeps the badge honest: on sign-in, every minute, whenever the app comes
  // back to the front, and when the service worker reports a push arrived.
  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    const message = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === "homi-push") void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    navigator.serviceWorker?.addEventListener("message", message);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      navigator.serviceWorker?.removeEventListener("message", message);
    };
  }, [active, identity.householdId, refresh]);

  const detectPush = useCallback(async () => {
    if (!pushSupported()) { setPush("unsupported"); return; }
    if (Notification.permission === "denied") { setPush("blocked"); return; }
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const id = latest.current;
      if (subscription && id.householdId && id.clientId && id.online) {
        const check = await call<{ subscribed: boolean }>(
          id, "/api/v1/core/push/subscriptions/check",
          { method: "POST", body: { endpoint: subscription.endpoint } },
        );
        setPush(check.subscribed ? "on" : "off");
        return;
      }
      setPush(subscription ? "on" : "off");
    } catch {
      setPush("off");
    }
  }, []);

  useEffect(() => {
    if (active) void detectPush();
  }, [active, identity.householdId, detectPush]);

  async function enablePush() {
    const id = latest.current;
    setPush("working");
    setFailure(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setPush(permission === "denied" ? "blocked" : "off"); return; }
      const { publicKey } = await call<{ publicKey: string }>(id, "/api/v1/core/push/config");
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: toKey(publicKey),
        }));
      const json = subscription.toJSON();
      await call(id, "/api/v1/core/push/subscriptions", {
        method: "POST",
        body: { endpoint: json.endpoint, keys: json.keys },
      });
      setPush("on");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      await detectPush();
    }
  }

  async function disablePush() {
    const id = latest.current;
    setPush("working");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        try {
          await call(id, "/api/v1/core/push/subscriptions/remove", {
            method: "POST", body: { endpoint: subscription.endpoint },
          });
        } finally {
          await subscription.unsubscribe();
        }
      }
      setPush("off");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      await detectPush();
    }
  }

  async function markRead(notificationId: string) {
    try {
      await call(latest.current, `/api/v1/core/notifications/${notificationId}/read`, { method: "POST" });
    } finally { await refresh(); }
  }
  async function dismiss(notificationId: string) {
    try {
      await call(latest.current, `/api/v1/core/notifications/${notificationId}/dismiss`, { method: "POST" });
    } finally { await refresh(); }
  }
  async function markAllRead() {
    try {
      await call(latest.current, "/api/v1/core/notifications/read-all", { method: "POST" });
    } finally { await refresh(); }
  }

  return { items, unread, failure, push, refresh, enablePush, disablePush, markRead, dismiss, markAllRead };
}

export type NotificationsState = ReturnType<typeof useNotifications>;

export function NotificationsSheet({
  open, onClose, state, locale,
}: {
  open: boolean;
  onClose: () => void;
  state: NotificationsState;
  locale: string;
}) {
  const format = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  // An action's own button disappears when it is done (a dismissed item, the
  // "Mark all read" button), which would drop keyboard focus out of the sheet
  // and leave Escape with nothing to hear it. Focus goes back to the inbox.
  const inbox = useRef<HTMLDivElement | null>(null);
  const then = (action: () => Promise<void>) => () => {
    void action().finally(() => inbox.current?.focus());
  };
  return (
    <BottomSheet
      portal
      open={open}
      title="Notifications"
      onDismiss={onClose}
      actions={
        <>
          {state.unread > 0 && (
            <Button variant="secondary" onClick={then(() => state.markAllRead())}>
              Mark all read
            </Button>
          )}
          <Button variant="quiet" onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="homi-notifications" ref={inbox} tabIndex={-1}>
        {state.failure && (
          <Notice tone="warning" title="Notifications need attention">{state.failure}</Notice>
        )}

        {state.push === "off" && (
          <Notice tone="neutral" title="Get reminders on this device">
            <p className="homi-notifications__text">
              Turn on notifications to receive reminders here, even when Homi is closed.
            </p>
            <Button onClick={() => void state.enablePush()}>Turn on notifications</Button>
          </Notice>
        )}
        {state.push === "on" && (
          <p className="homi-notifications__status">
            Notifications are on for this device.{" "}
            <button type="button" className="homi-notifications__link" onClick={() => void state.disablePush()}>
              Turn off
            </button>
          </p>
        )}
        {state.push === "blocked" && (
          <p className="homi-notifications__status">
            Notifications are blocked for Homi in this browser. Allow them in the browser's site settings to get reminders here.
          </p>
        )}
        {state.push === "unsupported" && (
          <p className="homi-notifications__status">
            This browser cannot show notifications when Homi is closed. Reminders will still appear here.
          </p>
        )}

        {state.items.length === 0 ? (
          <p className="homi-notifications__empty">Nothing yet. Reminders from your modules will appear here.</p>
        ) : (
          <ul className="homi-notifications__list">
            {state.items.map((item) => (
              <li
                key={item.id}
                className={`homi-notifications__item${item.readAt === null ? " is-unread" : ""}`}
              >
                <div className="homi-notifications__main">
                  <strong>{item.title}</strong>
                  {item.body && <span>{item.body}</span>}
                  <small>{format.format(new Date(item.createdAt))}</small>
                </div>
                <div className="homi-notifications__actions">
                  {item.readAt === null && (
                    <Button variant="quiet" onClick={then(() => state.markRead(item.id))}>Mark read</Button>
                  )}
                  <Button variant="quiet" onClick={then(() => state.dismiss(item.id))}>Dismiss</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </BottomSheet>
  );
}
