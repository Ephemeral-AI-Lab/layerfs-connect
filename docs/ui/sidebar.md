# Sidebar

The app's left column: the brand, Resources, and every LayerFS project. Opens from: always shown,
on the left of the window.
Source: `src/renderer/src/components/app-sidebar.tsx` (every region is in this file).

## Skeleton

```text
+-[1] Brand ---------------------------+
| [o] LayerFS Connect                  |
+-[2] Resources -----------------------+
| RESOURCES                            |
|    Storage                           |
|    Compute                           |
+-[3] Projects ------------------------+
| PROJECTS  14                       + |
|  /\ shop                          *  |
|  /\ api   team                       |
|  /\ web                              |
|  ...                     (scrolls)   |
+-[4] Footer --------------------------+
| Language                             |
+--------------------------------------+
```

## Regions

1. **Brand**: the Connect mark in a liquid-glass tile and "LayerFS Connect".
2. **Resources**: Storage and Compute, with a sliding glass indicator on the open one.
3. **Projects** (`ProjectList`): the project directory shared with the Projects page and Chat
   (`useProjects`). The "Projects" heading, with the count, opens the Projects page; + opens the
   New project dialog ([dialog-new-project.md](dialog-new-project.md)). Each project is a row with
   the LayerFS mark and its name (a shared Store's name faint after it, and a pulsing dot while a
   scenario plays on it); a click opens the project page. The section fills the rest of the
   column and its list scrolls.
4. **Footer**: the language switcher.

There is no Chat item: Chat opens from New chat on a project and from the chat page's history.

**Off for now (2026-10-31):** the older project tree with each project's sessions (chats and
scenario runs), its All / Running filter and "Local chats" (`ProjectTree`) is not shown;
`SHOW_PROJECT_TREE` turns it back on. Scenario runs open from a project's Sessions tab.

## States

- **Loading**: three skeleton rows under Projects.
- **Error**: "Could not load projects." with Retry.
- **Empty**: "Create project" under the Projects heading.
- **Selected**: the open Resources page (sliding indicator), the Projects heading on the Projects
  page, or the open project's row (a glass pill).
