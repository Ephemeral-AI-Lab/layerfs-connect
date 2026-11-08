<!-- Hallmark · pre-emit critique: P4 H4 E4 S5 R5 V4 -->
# DeepSeek Harness navigation study

Studied 2026-11-08, installed version 0.2.2-rc.1.

## Original TypeScript source follow-up

The repository was subsequently cloned to `/Users/yifanxu/Ephemeral-AI-Lab/deepseek-harness-source` and inspected at commit `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`. This source is newer than the installed npm package. The sections below this follow-up describe the installed release unless otherwise stated.

### How the pattern is built

- `packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx:75` derives the ancestor chain from `parentId`, with cycle protection. The header at line 108 renders the hierarchy and gives subagent titles a `conversation.session.header.lineage` extension position. Its separate view-tab row keeps Chat first and folds additional views into More based on available width.
- `packages/client/ui-subagent/src/client/index.ts:56` binds two independent actions: `openChild` selects the main conversation; `openChildAside` opens the same child as a right-panel resource with `preferNewPane: true`. Lines 73–103 register the lineage, header action, and composer contributions. The main conversation component does not need to own the subagent tree implementation.
- `packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx:834` suppresses the root count action inside child sessions. At line 873, the child's title switcher uses its **parent's catalog** to find siblings, while a separate count uses the **child's own catalog** to find descendants. Ancestor switchers remain muted and omit redundant descendant counts.
- `packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx:243` renders recursive rows from projected catalog membership. Opening a nested child passes its exact direct-parent address, `{parentSessionId, childSessionId, mode}`. The expansion arrow, navigation body, and trailing sidebar action are separate targets.
- `packages/client/ui-subagent/src/client/sidebar-chat/index.tsx:102` retains a child session for the resource lifetime and releases it on closure. At line 129 it embeds the same conversation content implementation under the child's `SessionProvider`, with the local view fixed to Chat. This avoids a second, divergent subagent transcript implementation.
- `packages/client/ui-workspace/src/client/navigation.ts:523` retains the incoming main session before replacing selection and releasing the previous reference. The selected child address is saved alongside the session id for restoration.

### Refinements in the newer source

The source CSS has a container query at 460px that turns the count action into a 28px icon button. The surrounding header hides passive preset text at 540px first, making progressively more room for navigation. The icon-only trigger opens by click or keyboard rather than hover. The current source uses CSS anchor positioning for the menu, wraps descriptions and names in rows, and prioritizes task descriptions above agent names. Optional shared tasks can contribute to the root catalog through a footer slot.

Continuable children no longer elect a read-only composer just because their creator is unavailable; only one-shot and unknown modes do so in the inspected source. This differs from the installed release behavior described below.

### Tests inspected, not executed

- `packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx:520`: main versus sidebar actions preserve the same child address.
- The same file at line 1132: expanding a child loads its catalog; selecting a grandchild uses the child as its direct parent.
- The same file at line 1637: ancestor styling and click behavior; line 1698: a nested title switcher shows only the direct parent's catalog.
- The same file near lines 581–675: compact click/keyboard opening, hover suppression, focus restoration, and tooltips.
- `packages/client/ui-subagent/tests/sidebar-chat.client.spec.tsx:60`: resource/tab registration and retained child lifetime.
- `packages/client/ui-workspace/tests/tree.client.spec.ts:360`: subagent-origin sessions stay out of the top-level list while parent rows expose running child counts.

**Reusable principle:** keep project selection, agent hierarchy, conversation views, and side-by-side inspection as distinct navigation scopes; route each scope through the same session identity and shared conversation renderer.

## Central finding

Navigation is organized by scope. The left sidebar selects a project or conversation. The conversation header explains where the current agent sits in the delegation hierarchy. The right panel supports inspecting related work while preserving the main conversation.

This makes delegation a navigable part of the session, accessible independently of the transcript's scroll position.

## Evidence and limits

I inspected the running interface, its workspace view menu, and the right panel, and read the installed client implementation. This installation has no configured model and no real child sessions. Subagent behavior below is verified in source; its populated runtime appearance and behavior have not been exercised. No model calls or subagents were launched for this study.

## Navigation by scope

| Surface | User question | Pattern |
| --- | --- | --- |
| Left sidebar | Which project or conversation? | Workspaces and top-level sessions; session search; grouping, order, and archive controls. |
| Conversation header | Where am I in this task? | Ancestor breadcrumbs, clickable parents, current-agent sibling switcher, child catalog. |
| View tabs | Which representation of this conversation? | Chat plus registered views; pin controls and width-dependent overflow into More. |
| Right panel | What related work should I inspect alongside this? | Resource tabs, split and fullscreen controls, embedded child conversations. |
| Composer | How will my next message run? | Model and permission controls near the input. Blank-session workspace and mode selection are also placed near the composer. |

## Header subagent behavior

1. **Parent session:** a compact child-count dropdown appears in the header actions area when there are children or a catalog error. Running children add an activity indicator. The displayed count is the direct-child total; the accessible label can communicate the running count.
2. **Inside a child:** the header renders the ancestor chain. Ancestor titles navigate upward; the child title becomes a sibling switcher. The current child can also expose its own child-count dropdown.
3. **Dropdown:** an expandable tree preserves delegation depth. Rows show the agent label, secondary title/mode/activity information, and available token and active-duration metrics. The current row receives stronger emphasis.
4. **Two destinations:** selecting a row opens that child in the main conversation. A separate row action opens it in the right sidebar, keeping the current main conversation visible.
5. **Continuation rules:** one-shot child records replace the composer with an explanation. Continuable children whose parent is unavailable explain how to regain the ability to send. Unknown modes have a separate explanatory state.

The distinction between **switching focus** and **inspecting alongside** is particularly valuable: users can check delegated work without losing the place where they are coordinating it.

## Interaction details worth retaining

- The tree includes explicit loading, error, retry, current-item, and activity states. It does not treat every inactive agent as completed.
- Descendant branches load when explicitly expanded, keeping initial navigation compact.
- Keyboard support covers Up/Down, Home/End, Left/Right expansion, Enter/Space selection, and Escape with trigger focus restoration.
- Dropdown positioning respects viewport edges; its body scrolls within bounded dimensions.
- Hover previews the catalog after 150 ms; a click pins it open. Touch skips hover behavior.
- View overflow preserves the selected-view indication in More when the active view is not visible in the tab row.
- The sidebar summarizes running child counts on the top-level session rather than needing to expose the full delegation tree there.

## Design interpretation

The hierarchy works because each navigation surface has a clear job. The header combines location, activity awareness, and navigation at the exact scope where delegation happens. Progressive disclosure keeps normal conversation calm while retaining an accessible tree for complex work.

Visually, the inspected empty state uses light neutral surfaces, a subtly separated sidebar, thin boundaries, small outline icons, and generous central space. Typography is a restrained sans-serif hierarchy. These observations are secondary to the interaction structure; no exact font identification is claimed from the screenshot.

## What to adapt carefully

- Keep essential hierarchy navigation available on click, touch, and keyboard; hover should remain optional.
- The source's 150 ms hover delay and 120 ms close delay may feel eager. Validate them with real pointer movement before adopting them.
- Deep ancestry and long labels need a deliberate narrow-width strategy. The inspected source shows truncation, but this study did not verify populated mobile layouts.
- Put status near the task name, with clear words available; preserve the distinction between completed, inactive, and needing attention.
- Reuse the hierarchy and navigation principles while retaining the destination application's own visual language.

## Implementation references

Paths are relative to `/Users/yifanxu/Ephemeral-AI-Lab/deepseek-harness`.

- `node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js`: `CatalogRows` (line 165), `CatalogDropdown` (line 358), `SubagentCatalogAction` (line 615), `SubagentHeaderLineage` (line 637), embedded sidebar conversation and routing, and header slot registration near the end of the file.
- `node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`: `deriveAncestry` (line 20777) and `ConversationSessionHeader` (line 20808), including breadcrumb rendering and adaptive view overflow.
- `node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/types/client/tree.d.ts`: workspace tree and top-level session state, including running subagent counts and pending interaction indicators.
- `node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/types/client/navigation.d.ts`: shared session/workspace navigation and draft reuse contracts.

No application code was changed.
