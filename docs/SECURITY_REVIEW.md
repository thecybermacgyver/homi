# Application security review

Review date: 2026-09-23. Scope: Homi Core, web shell, module manager, Calendar 0.6.7, Chequebook 0.1.11, and deployment proxy configuration.

## Result

The reviewed release candidate passes the application-security gate. This is a point-in-time source and deployment review, not a promise that future code is vulnerability-free. Private vulnerability reports follow SECURITY.md.

## Controls and evidence

- Authentication: Better Auth requires a secret of at least 32 characters, limits trusted browser origins to HOMI_AUTH_BASE_URL, disables public sign-up, and uses its built-in authentication endpoint rate limiting. The one-time bootstrap runs as an isolated maintenance command and fails closed after the first account exists.
- Authorization: Core resolves the authenticated subject and household membership server-side. Administrative module install, update, enable, disable, uninstall, settings, and household mutations require explicit permissions; browser-supplied household identifiers do not grant access.
- CSRF and sessions: browser requests use same-origin credentials; Better Auth validates trusted origins and its session-cookie protections apply to authentication. The public deployment serves Core only through Homi's same-origin reverse proxy.
- Upload and import parsing: module archives have compressed/uncompressed size and file-count limits; invalid tar headers, traversal, absolute paths, links, unsupported entries, identity mismatches, and digest mismatches fail closed. Calendar XML parsing uses the patched fast-xml-parser release and request bodies remain subject to Fastify's bounded default body limit.
- SSRF: module downloads accept only immutable trusted GitHub release locations. Calendar 0.6.7 restricts CalDAV credentials to HTTPS on caldav.icloud.com or its subdomains, port 443, no embedded credentials, at most five redirects, and revalidates every redirect before forwarding credentials. The permanent security test proves direct and redirect SSRF attempts are blocked.
- XSS and browser isolation: no dangerouslySetInnerHTML, innerHTML assignment, eval, or Function-constructor use was found in application source. The web proxy now sends a self-only Content Security Policy, frame denial, MIME sniffing protection, same-origin opener/resource policies, a restricted permissions policy, and same-origin referrer policy.
- Sensitive logging: normal request errors use structured server logging without logging credentials. Module-manager child-process stderr is bounded. User-facing 5xx responses return a generic error code and request ID.
- Supply chain: the frozen lockfile is installed under pnpm's supply-chain checks; CI builds, typechecks, validates module contracts/directory/lifecycle, and rejects high or critical production dependency findings.

## Verification performed

- Full workspace build and typecheck passed before this review checkpoint.
- Calendar manifest and provider-security validation passed; Chequebook manifest validation passed.
- Production dependency audit had no high or critical findings.
- The updated Nginx image built successfully in the isolated release environment.
- Actual responses for the SPA shell, a hashed JavaScript asset, and a proxied unauthorized API response all contained the required security headers. Shell no-store and hashed-asset immutable caching remained correct.
- Production was not modified during this review.

## Deployment boundary

TLS termination must add HSTS at the HTTPS edge. HSTS is intentionally not emitted by the internal HTTP container because it cannot know whether a request reached it through TLS. Operators must keep Core and the module manager off public ports and rotate all secrets before first deployment.
