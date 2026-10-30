# Agent harness baseline

Connect uses Pi's agent loop and session tree, bash for file operations, and
pi-subagents for delegation. The desktop owns execution policy, workspace
lifecycle, persistent user state and the presentation of those events.

| Area | Behavior |
| --- | --- |
| Execution | Streaming text, reasoning and tool results; stop, queued follow-ups and steering; explicit continuation from saved state |
| Recovery | Interrupted sessions expose a recovery state. Continue completes outstanding cleanup and starts through Pi's high-level API, preserving completed tool results |
| Limits | Per-conversation turn and runtime budgets, a default bash timeout shared with children, and bounded native provider retries |
| Instructions | Root and child agents load the actual execution directory's project instructions, plus conversation instructions; unavailable context aborts the run |
| Inputs | UTF-8 text files and native image messages, retained through history, editing, copying and restart |
| Context | Automatic/manual compaction, context-window estimates and recorded main-agent history usage |
| Permissions | Full access by default for new and loaded chats, shared by root and child bash; no desktop permission selector |
| LayerFS | Immutable per-message checkpoints, automatic commits, independent copies and revision branches for restore/edit |
| Tools | Streamed preview, complete owned output artifacts, explicit timeout/error results, and verified process cancellation |
| Subagents | Task/result/status cards, whole-conversation stop and separate stop for controllable background runs |
| Conversations | Rename, archive/restore, search, copy, export, revert, edit/resend and independent duplication |
| Drafts | Per-session and per-project/folder drafts, persisted with attachments; delayed storage reads do not replace newer typing |
| Transport | Shared authenticated event stream, visible reconnection state and snapshot refresh after reconnect |

## Limits and continuation

New conversations default to 32 main-agent model turns, 1,800 seconds per run,
a 120-second default bash timeout and up to two native main-agent provider retries. Run
settings can be chosen before sending the first message and changed while
idle. Zero disables the turn/runtime ceiling; the default command timeout
remains positive. A model may request an explicit command timeout. Turn and
retry counts apply to the main Pi session; command defaults and the overall
deadline cover its child agents as well.

The runtime ceiling includes still-running background children. Reaching it
uses the normal stop path: abort Pi and children, confirm remote processes
have stopped, save LayerFS changes and release its workspace. A stopped or
failed task can continue with the existing context instead of replaying the
last user prompt and completed commands.

Recorded usage comes from the persisted Pi tree. It includes copied and
branched main-agent history; it is not a new-charge billing ledger or a
complete bill for all child agents.

## Inputs and project instructions

Attachments accept at most ten files and 20 MiB in total. A UTF-8 text file
may be up to 1 MiB; a PNG, JPEG, WebP or GIF may be up to 10 MiB. Images require
an image-capable model. Text attachments are clearly delimited inside the
model prompt; the original prompt and attachment metadata remain available
for display and editing. Attachment bytes are returned on full snapshots,
while streaming events carry metadata to avoid retransmitting large files
with every token.

Instruction precedence in each directory is `AGENTS.override.md`, `AGENTS.md`,
`AGENTS.MD`, `CLAUDE.md`, then `CLAUDE.MD`. Local conversations load outer
directories before the selected working directory. LayerFS conversations read
the real mounted project root rather than Pi's host control directory. Agents
still inspect more specific subdirectory rules through bash before editing.

## Artifacts and organization

Full bash output is stored privately under the owning conversation's
`tool-output/` folder, outside the user's project. The desktop reads it in
64 KiB pages and keeps UTF-8 characters intact. Conversation copies retain
their output artifacts. A LayerFS bash command cannot read a host-side log
path; agents should redirect large output to a workspace file when they need
to inspect it themselves.

Archiving closes idle resources while retaining Pi data and LayerFS branches.
Restoring an archived conversation does not start a model request. Exported
Markdown/JSON contains conversation content, not model connection credentials.
Draft attachments use IndexedDB, with a synchronous text fallback for reloads.

## Native extension commands

Registered Pi commands run through Pi's command dispatcher, including while a
model turn is running. A command or input hook that handles its input does not
need to create a user message. Ordinary model input still waits for Pi's saved
user entry before the desktop clears its draft. Plugin operations do not replace
the promise tracking the current model run or consume its pending follow-ups.

Input hooks retain their transformed text and images when a follow-up becomes
steering input. Stop cancels pending plugin input and dialogs as well as model
work. Late replies belong to the cancelled operation and cannot start a new run
or resume a session replacement after Stop, including while a before-switch
hook or workspace checkpoint is awaited.

Native session actions use Connect's conversation records. New sessions retain
the working directory, model and run settings; project sessions fork their
current file checkpoint into an independent branch with empty chat context.
Forks distinguish `before` from `at`, and callbacks receive the new Pi context.
Switching accepts registered conversations, and reload retains the current Pi
file and LayerFS branch. Unsupported project tree navigation or an `at` target
without an exact file checkpoint returns cancellation without moving history.
Successful replacements navigate the desktop only if the user is still viewing
the source conversation, while keeping drafts for both conversations.

## Verification

```bash
pnpm typecheck
pnpm build
pnpm test:agents
CONNECT_REAL_LAYERFS=1 node --import ./host/resolve-layerfs.js --test --test-timeout=200000 host/test/agent-layerfs-real.test.js
```

The real LayerFS test uses a disposable project, its own container prefix,
and a deterministic loopback model server. It checks root/child instructions,
file isolation, checkpoints and history operations, command cancellation,
attachments and restart behavior without calling a paid model.
