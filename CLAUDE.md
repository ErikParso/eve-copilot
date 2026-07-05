# eve-multitool

## Memory — use the Obsidian vault, not the local memory dir

All persistent memory for this project lives in the Obsidian vault at
`C:\dev_vault`, under `Projects/eve-multitool/`. This folder is the **single
source of truth** for memories — do not use Claude Code's local file-based
memory directory for storage.

The folder is a working directory and is reachable directly, so use **direct
file tools** (`Write` / `Edit` / `Read` / `Grep` / `Glob`) on it — no need for
the `obsidian` MCP for memory. Obsidian re-indexes the plain `.md` files on save.

**Saving a memory:** `Write`/`Edit` a note in `Projects/eve-multitool/`. One
idea per note, YAML frontmatter + `[[wikilinks]]`, following the vault's
`_conventions.md`. Update an existing note rather than creating a near-duplicate.
Add a one-line pointer to `Projects/eve-multitool/MEMORY.md`.

**Recalling memory:** `MEMORY.md` auto-loads at session start via the junction;
`Grep`/`Glob`/`Read` the folder for relevant notes before and during a task.

**Do not commit or push the vault** unless I explicitly ask. Leave vault edits
uncommitted and report what changed and where.

See `C:\dev_vault\_agent-instructions.md` for the full vault workflow (sync,
consult, maintain).
