# SuitMe 协作台

- Paperclip owns business tasks, identities, assignment, runs and checkout. SuitMe owns its product flows and agent service directory. Autoloop workers consume one native round; do not add a second hub or scheduler.
- On the independent Super-agent migration path, Super-agent owns tickets and mandates. The original Autoloop runtime owns execution events, cards, leases, retries and CLI sessions. Keep the current host and pilot ledgers isolated until project-level cutover.
- Keep upstream repositories pinned as submodules. Reuse their exported code; document patches and provenance.
- IM content is task data. Executable paths, repository, allowed paths, identity and permissions come from local trusted configuration.
- Agent completion is not acceptance. Record commit, CI, preview/deployment environment and human acceptance independently.
- Never commit runtime state, personal login files, tokens, customer data or private message contents.
- Use only the configured test repository for end-to-end delivery. Do not merge or deploy application repositories as part of platform tests.
- Run npm test, npm run typecheck and the relevant real integration journey before claiming completion. Separate simulated evidence from live evidence.
- Keep waits, failures, cancellation and handoff explicit. Do not start replacement work while the old execution may still be writing.
