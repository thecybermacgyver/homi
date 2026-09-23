import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export type HomiTone = "neutral" | "success" | "warning" | "danger";
export type HomiButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: HomiButtonVariant;
}

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("homi-ui-button", `homi-ui-button--${variant}`, className)}
      {...props}
    />
  );
}

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  label: string;
}

export function IconButton({
  label,
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx("homi-ui-icon-button", className)}
      {...props}
    />
  );
}

export type SurfacePadding = "none" | "compact" | "normal" | "roomy";

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: "section" | "article" | "div";
  padding?: SurfacePadding;
}

export function Surface({
  as = "section",
  padding = "none",
  className,
  ...props
}: SurfaceProps) {
  const Component = as;
  return (
    <Component
      className={cx(
        "homi-ui-surface",
        `homi-ui-surface--padding-${padding}`,
        className,
      )}
      {...props}
    />
  );
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: HomiTone;
}

export function Badge({
  tone = "neutral",
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cx("homi-ui-badge", `homi-ui-badge--${tone}`, className)}
      {...props}
    />
  );
}

export interface NoticeProps extends HTMLAttributes<HTMLDivElement> {
  tone?: HomiTone;
  title?: string;
}

export function Notice({
  tone = "neutral",
  title,
  className,
  children,
  ...props
}: NoticeProps) {
  return (
    <div
      className={cx("homi-ui-notice", `homi-ui-notice--${tone}`, className)}
      {...props}
    >
      {title && <strong>{title}</strong>}
      <div>{children}</div>
    </div>
  );
}

export interface FormFieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export function FormField({
  label,
  htmlFor,
  hint,
  error,
  children,
}: FormFieldProps) {
  return (
    <label className="homi-ui-form-field" htmlFor={htmlFor}>
      <span className="homi-ui-form-field__label">{label}</span>
      {children}
      {error ? (
        <span className="homi-ui-form-field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="homi-ui-form-field__hint">{hint}</span>
      ) : null}
    </label>
  );
}

export function TextField({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("homi-ui-input", className)} {...props} />;
}

export function TextArea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx("homi-ui-textarea", className)} {...props} />;
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx("homi-ui-select", className)} {...props} />;
}

export interface LabeledControlProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
}

export function Checkbox({
  label,
  className,
  ...props
}: LabeledControlProps) {
  return (
    <label className="homi-ui-check">
      <input
        type="checkbox"
        className={cx("homi-ui-check__control", className)}
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}

export function Switch({
  label,
  className,
  ...props
}: LabeledControlProps) {
  return (
    <label className="homi-ui-switch">
      <input
        type="checkbox"
        role="switch"
        className={cx("homi-ui-switch__control", className)}
        {...props}
      />
      <span className="homi-ui-switch__track" aria-hidden="true">
        <span />
      </span>
      <span>{label}</span>
    </label>
  );
}

export interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="homi-ui-empty-state">
      <div className="homi-ui-empty-state__mark" aria-hidden="true">
        ⌂
      </div>
      <strong>{title}</strong>
      <p>{description}</p>
      {action && <div>{action}</div>}
    </div>
  );
}

export interface DialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
}

const MODAL_FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function ModalSurface({
  open,
  title,
  children,
  actions,
  onDismiss,
  sheet = false,
}: DialogProps & { sheet?: boolean }) {
  const surfaceRef = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const surface = surfaceRef.current;
    const first = surface?.querySelector<HTMLElement>(MODAL_FOCUSABLE);
    (first ?? surface)?.focus();

    return () => previouslyFocused?.focus();
  }, [open]);

  if (!open) return null;

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && onDismiss) {
      event.preventDefault();
      onDismiss();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div
      className={sheet ? "homi-ui-sheet-backdrop" : "homi-ui-dialog-backdrop"}
      role="presentation"
    >
      <section
        ref={surfaceRef}
        className={sheet ? "homi-ui-sheet" : "homi-ui-dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="homi-ui-dialog__heading">
          <h2 id={titleId}>{title}</h2>
          {onDismiss && (
            <IconButton label="Close" onClick={onDismiss}>
              ×
            </IconButton>
          )}
        </div>
        <div className="homi-ui-dialog__body">{children}</div>
        {actions && <div className="homi-ui-dialog__actions">{actions}</div>}
      </section>
    </div>
  );
}

export function Dialog(props: DialogProps) {
  return <ModalSurface {...props} />;
}

export interface BottomSheetProps extends DialogProps {}

export function BottomSheet(props: BottomSheetProps) {
  return <ModalSurface {...props} sheet />;
}

export interface NavigationItem {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
}

export interface NavigationProps {
  items: readonly NavigationItem[];
  activeId: string;
  onNavigate: (id: string) => void;
}

function NavigationButton({
  item,
  active,
  onNavigate,
}: {
  item: NavigationItem;
  active: boolean;
  onNavigate: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={cx("homi-ui-nav-button", active && "is-active")}
      aria-current={active ? "page" : undefined}
      onClick={() => onNavigate(item.id)}
    >
      {item.icon && <span className="homi-ui-nav-button__icon">{item.icon}</span>}
      <span>{item.label}</span>
      {item.badge && <span className="homi-ui-nav-button__badge">{item.badge}</span>}
    </button>
  );
}

export function BottomNavigation({
  items,
  activeId,
  onNavigate,
}: NavigationProps) {
  return (
    <nav className="homi-ui-bottom-nav" aria-label="Primary">
      {items.map((item) => (
        <NavigationButton
          key={item.id}
          item={item}
          active={item.id === activeId}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}

export function SideNavigation({
  items,
  activeId,
  onNavigate,
}: NavigationProps) {
  return (
    <nav className="homi-ui-side-nav" aria-label="Primary">
      {items.map((item) => (
        <NavigationButton
          key={item.id}
          item={item}
          active={item.id === activeId}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}

export interface AppHeaderProps {
  brandIconSrc?: string;
  brandName?: string;
  tagline?: string;
  householdName?: string;
  status?: ReactNode;
  action?: ReactNode;
}

export function AppHeader({
  brandIconSrc,
  brandName = "Homi",
  tagline = "Home, together.",
  householdName,
  status,
  action,
}: AppHeaderProps) {
  return (
    <header className="homi-ui-app-header">
      <div className="homi-ui-brand">
        {brandIconSrc && (
          <img src={brandIconSrc} alt="" className="homi-ui-brand__icon" />
        )}
        <div>
          <span className="homi-ui-brand__name">{brandName}</span>
          <span className="homi-ui-brand__tagline">{tagline}</span>
        </div>
      </div>
      <div className="homi-ui-app-header__context">
        {householdName && (
          <span className="homi-ui-app-header__household">{householdName}</span>
        )}
        {status}
        {action}
      </div>
    </header>
  );
}

export interface AppShellProps extends NavigationProps {
  children: ReactNode;
  brandIconSrc?: string;
  householdName?: string;
  status?: ReactNode;
  headerAction?: ReactNode;
  variant?: "default" | "family-board";
}

export function AppShell({
  children,
  brandIconSrc,
  householdName,
  status,
  headerAction,
  variant = "default",
  items,
  activeId,
  onNavigate,
}: AppShellProps) {
  return (
    <div
      className={cx(
        "homi-ui-app-shell",
        variant === "family-board" &&
          "homi-ui-app-shell--family-board",
      )}
    >
      <AppHeader
        {...(brandIconSrc !== undefined ? { brandIconSrc } : {})}
        {...(householdName !== undefined ? { householdName } : {})}
        {...(status !== undefined ? { status } : {})}
        {...(headerAction !== undefined ? { action: headerAction } : {})}
      />
      <div className="homi-ui-shell-layout">
        <aside className="homi-ui-shell-sidebar">
          <SideNavigation
            items={items}
            activeId={activeId}
            onNavigate={onNavigate}
          />
        </aside>
        <main className="homi-ui-shell-content">{children}</main>
      </div>
      <BottomNavigation
        items={items}
        activeId={activeId}
        onNavigate={onNavigate}
      />
    </div>
  );
}

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <header className="homi-ui-page-header">
      <div>
        {eyebrow && <p className="homi-ui-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="homi-ui-page-header__actions">{actions}</div>}
    </header>
  );
}

export function ModuleHeader(props: PageHeaderProps) {
  return <PageHeader {...props} />;
}

export interface SetupLayoutProps {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}

export function SetupLayout({
  title,
  description,
  children,
  actions,
}: SetupLayoutProps) {
  return (
    <Surface className="homi-ui-setup-layout">
      <PageHeader
        title={title}
        {...(description !== undefined ? { description } : {})}
      />
      <div className="homi-ui-setup-layout__body">{children}</div>
      {actions && <div className="homi-ui-setup-layout__actions">{actions}</div>}
    </Surface>
  );
}

export interface SettingsSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function SettingsSection({
  title,
  description,
  children,
}: SettingsSectionProps) {
  return (
    <Surface className="homi-ui-settings-section">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      <div className="homi-ui-settings-section__body">{children}</div>
    </Surface>
  );
}

export interface TabItem {
  id: string;
  label: string;
}

export interface TabsProps {
  items: readonly TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  label: string;
}

export function Tabs({
  items,
  activeId,
  onChange,
  label,
}: TabsProps) {
  return (
    <div className="homi-ui-tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === activeId}
          className={cx(
            "homi-ui-tab",
            item.id === activeId && "is-active",
          )}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export interface SearchFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export function SearchField({
  label = "Search",
  className,
  ...props
}: SearchFieldProps) {
  return (
    <label className="homi-ui-search">
      <span className="homi-ui-visually-hidden">{label}</span>
      <span aria-hidden="true">⌕</span>
      <input
        type="search"
        className={cx("homi-ui-search__input", className)}
        placeholder={props.placeholder ?? label}
        {...props}
      />
    </label>
  );
}
