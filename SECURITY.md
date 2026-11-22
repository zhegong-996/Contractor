# Security policy

## Supported versions

Security fixes target the current `0.1.x` release line. Older snapshots and historical audit examples are kept for traceability and are not supported deployment targets.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** flow to open a private GitHub security advisory. Include the affected version or commit, the deployment mode, reproduction steps, impact, and any known mitigation. Do not open a public issue before a fix and disclosure plan are agreed.

Do not include production credentials, customer records, private IM content, repository tokens, or personal data in a report. Replace them with local fixtures or redacted values.

The maintainers will confirm receipt, assess severity and scope, and coordinate remediation and disclosure in the private advisory. Response and release timing depend on reproduction and deployment impact.

## Sensitive configuration

Runtime state belongs outside the repository. Keep model keys, IM secrets, login sessions, worker credentials, webhook secrets, private project sources, and acceptance evidence in the deployment's protected state directory. The repository's examples use disabled agents and synthetic values.
