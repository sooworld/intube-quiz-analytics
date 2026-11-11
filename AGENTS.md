<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Code
- Do not preserve backward compatibility in code. Remove obsolete code paths instead of adding compatibility layers, fallbacks, or migrations. This does not apply to raw data, metric definitions, or reported results (see Data).
- Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
- Keep components modular with clearly separated concerns.
- Prefer established, well-maintained libraries over reimplementation. Use dependencies already in the project before adding new ones. Check documentation and types before concluding a library lacks a capability.
- Match design effort to how hard a decision is to undo. Data schemas, metric definitions, and raw data storage get long-term design, with no stopgaps. Analysis code gets the minimal implementation.