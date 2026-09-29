import { useEffect, useState, type FormEvent } from "react";
import {
  Badge,
  BottomSheet,
  Button,
  FormField,
  Notice,
  Surface,
  TextField,
} from "@homi/ui";
import {
  HomiAuthActionError,
  changeOwnPassword,
  listHouseholdMembers,
  resetMemberPassword,
  type HouseholdMember,
} from "./auth-actions.js";

// Matches Core's HOMI_MIN_PASSWORD_LENGTH; Core enforces it authoritatively.
const MIN_PASSWORD_LENGTH = 10;

function failureText(error: unknown): string {
  if (error instanceof HomiAuthActionError) {
    switch (error.code) {
      case "CURRENT_PASSWORD_INCORRECT":
        return "The current password is incorrect.";
      case "PASSWORD_ATTEMPTS_EXCEEDED":
        return "Too many incorrect attempts. Try again in 15 minutes.";
      case "PASSWORD_UNCHANGED":
        return "Choose a password different from the current one.";
      case "AUTH_TRANSPORT_FAILED":
        return "Homi could not be reached. Check the connection and try again.";
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

// Letters and digits without look-alikes (0/O, 1/l/I), so a temporary password
// can be read out or copied by hand without mistakes.
const TEMPORARY_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateTemporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return [...bytes]
    .map((byte) => TEMPORARY_ALPHABET[byte % TEMPORARY_ALPHABET.length])
    .join("")
    .replace(/(.{4})(?=.)/g, "$1-");
}

function newPasswordProblem(current: string, next: string, confirm: string): string | null {
  if (next.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (next !== confirm) return "The new passwords do not match.";
  if (next === current) return "Choose a password different from the current one.";
  return null;
}

interface PasswordChangeFormProps {
  readonly currentLabel: string;
  readonly submitLabel: string;
  readonly online: boolean;
  onChanged(): void | Promise<void>;
}

function PasswordChangeForm(props: PasswordChangeFormProps) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = newPasswordProblem(current, next, confirm);
    if (problem) {
      setFailure(problem);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await changeOwnPassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      await props.onChanged();
    } catch (error) {
      setFailure(failureText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="homi-platform-auth__form" onSubmit={(event) => void submit(event)}>
      <FormField label={props.currentLabel} htmlFor="homi-password-current">
        <TextField id="homi-password-current" type="password" autoComplete="current-password"
          value={current} onChange={(event) => setCurrent(event.target.value)} disabled={busy} required />
      </FormField>
      <FormField label="New password" htmlFor="homi-password-new"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
        <TextField id="homi-password-new" type="password" autoComplete="new-password"
          value={next} onChange={(event) => setNext(event.target.value)} disabled={busy} required />
      </FormField>
      <FormField label="Confirm new password" htmlFor="homi-password-confirm">
        <TextField id="homi-password-confirm" type="password" autoComplete="new-password"
          value={confirm} onChange={(event) => setConfirm(event.target.value)} disabled={busy} required />
      </FormField>
      {failure && <Notice tone="danger" title="Password not changed">{failure}</Notice>}
      <Button type="submit" disabled={busy || !props.online}>
        {busy ? "Saving…" : props.online ? props.submitLabel : "Offline"}
      </Button>
    </form>
  );
}

interface RequiredPasswordChangeProps {
  readonly online: boolean;
  readonly signOutBusy: boolean;
  onChanged(): Promise<void>;
  onSignOut(): void;
}

// Shown instead of Homi when an administrator has reset this member's password.
export function RequiredPasswordChange(props: RequiredPasswordChangeProps) {
  return (
    <main className="homi-platform-auth">
      <Surface className="homi-platform-auth__card">
        <img src="/brand/homi_logo.png" alt="Homi" className="homi-platform-auth__logo" />
        <p className="homi-ui-eyebrow">Home, together.</p>
        <h1>Choose a new password</h1>
        <p className="homi-platform-auth__intro">
          Your household administrator gave you a temporary password. Choose your own
          password to continue.
        </p>
        <PasswordChangeForm currentLabel="Temporary password" submitLabel="Save and continue"
          online={props.online} onChanged={props.onChanged} />
        <Button variant="quiet" onClick={props.onSignOut} disabled={props.signOutBusy}>
          Sign out
        </Button>
      </Surface>
    </main>
  );
}

// Settings row that lets a signed-in member change their own password.
export function ChangePasswordSetting(props: { readonly online: boolean }) {
  const [open, setOpen] = useState(false);
  const [changed, setChanged] = useState(false);
  return (
    <Surface className="homi-platform-setting-row">
      <div>
        <span className="homi-platform-card-kicker">Account</span>
        <strong>Password</strong>
        <p>{changed
          ? "Password changed. Your other devices have been signed out."
          : "Change the password you use to sign in."}</p>
      </div>
      <Button variant="secondary" onClick={() => { setChanged(false); setOpen(true); }} disabled={!props.online}>
        Change password
      </Button>
      <BottomSheet open={open} title="Change password" onDismiss={() => setOpen(false)}>
        {open && (
          <PasswordChangeForm currentLabel="Current password" submitLabel="Change password"
            online={props.online} onChanged={() => { setChanged(true); setOpen(false); }} />
        )}
      </BottomSheet>
    </Surface>
  );
}

interface HouseholdMembersSettingProps {
  readonly householdId: string;
  readonly clientId: string;
  readonly online: boolean;
}

// Administrators see the household's members and can reset a forgotten password.
export function HouseholdMembersSetting(props: HouseholdMembersSettingProps) {
  const [members, setMembers] = useState<readonly HouseholdMember[] | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [target, setTarget] = useState<HouseholdMember | null>(null);
  const [temporary, setTemporary] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!props.online) return;
    let active = true;
    listHouseholdMembers(props.householdId, props.clientId)
      .then((list) => { if (active) { setMembers(list); setAllowed(true); setFailure(null); } })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof HomiAuthActionError && error.status === 403) setAllowed(false);
        else setFailure(failureText(error));
      });
    return () => { active = false; };
  }, [props.householdId, props.clientId, props.online, generation]);

  if (!allowed) return null;

  async function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;
    if (temporary.length < MIN_PASSWORD_LENGTH) {
      setFailure(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await resetMemberPassword(props.householdId, props.clientId, target.membershipId, temporary);
      setIssued({ name: target.displayName, password: temporary });
      setTarget(null);
      setTemporary("");
      setGeneration((value) => value + 1);
    } catch (error) {
      setFailure(failureText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Surface className="homi-platform-setting-row homi-platform-members">
      <div>
        <span className="homi-platform-card-kicker">Household</span>
        <strong>Members</strong>
        <p>Reset a member's password if they have forgotten it. They choose a new one when they next sign in.</p>
      </div>
      {issued && (
        <Notice tone="success" title={`Temporary password for ${issued.name}`}>
          <span className="homi-platform-members__password">{issued.password}</span>
          <br />Give this to {issued.name}. It works once; they will choose their own password when they sign in.
          <br /><Button variant="quiet" onClick={() => setIssued(null)}>Done</Button>
        </Notice>
      )}
      {failure && !target && <Notice tone="danger" title="Members need attention">{failure}</Notice>}
      <ul className="homi-platform-members__list">
        {(members ?? []).map((member) => (
          <li key={member.membershipId} className="homi-platform-members__row">
            <div>
              <strong>{member.displayName}{member.self ? " (you)" : ""}</strong>
              {member.email && <span>{member.email}</span>}
              <span className="homi-platform-members__badges">
                {member.administrator && <Badge tone="neutral">Administrator</Badge>}
                {member.passwordChangeRequired && <Badge tone="warning">Must choose a new password</Badge>}
              </span>
            </div>
            {!member.self && (
              <Button variant="quiet" disabled={!props.online || busy}
                onClick={() => { setIssued(null); setFailure(null); setTemporary(generateTemporaryPassword()); setTarget(member); }}>
                Reset password
              </Button>
            )}
          </li>
        ))}
      </ul>
      <BottomSheet open={target !== null} title={`Reset password for ${target?.displayName ?? ""}`}
        onDismiss={() => setTarget(null)}>
        {target && (
          <form className="homi-platform-auth__form" onSubmit={(event) => void reset(event)}>
            <p>
              {target.displayName} will be signed out on every device and must use this temporary
              password once, then choose a new one.
            </p>
            <FormField label="Temporary password" htmlFor="homi-temporary-password"
              hint={`At least ${MIN_PASSWORD_LENGTH} characters. A strong one is filled in for you.`}>
              <TextField id="homi-temporary-password" autoComplete="off" value={temporary}
                onChange={(event) => setTemporary(event.target.value)} disabled={busy} required />
            </FormField>
            <Button variant="quiet" onClick={() => setTemporary(generateTemporaryPassword())} disabled={busy}>
              Generate another
            </Button>
            {failure && <Notice tone="danger" title="Password not reset">{failure}</Notice>}
            <Button type="submit" disabled={busy || !props.online}>
              {busy ? "Resetting…" : "Reset password"}
            </Button>
          </form>
        )}
      </BottomSheet>
    </Surface>
  );
}
