# LayerFS Connect

An agent app built on [pi](https://github.com/badlogic/pi-mono), where every
tool call an agent makes is saved as a LayerFS Commit. This is the LayerFS 2.0
app proposed in
[LayerFS #446](https://github.com/Ephemeral-AI-Lab/layerfs/issues/446).

Status: app shell only. The sidebar shows sample projects and sessions; the
main page is empty. pi and LayerFS are not wired in yet.

## Stack

Electron + electron-vite, React 19, Tailwind CSS v4 and shadcn/ui, TypeScript.
pi and the LayerFS SDK will run in a separate host process that the UI reaches
over one WebSocket protocol; Electron's main process only manages windows.

```
src/
  main/              Electron main process (windows only)
  preload/           exposes the platform name to the renderer
  renderer/
    index.html
    src/
      App.tsx        sidebar + empty main page
      styles.css     theme: Tailwind + shadcn variables
      components/    app-sidebar, layerfs-mark, ui/ (shadcn)
      data/          sample sidebar data
```

## Develop

Needs Node 22.12 or later and pnpm.

```bash
pnpm install
pnpm dev         # app with hot reload
pnpm typecheck
pnpm build       # production build into out/
pnpm start       # run the production build
```

Add shadcn components with `pnpm exec shadcn add <name>`.

`CONNECT_SHOT=<file.png>` saves a screenshot of the window once it has loaded,
then quits; it works with `pnpm dev` and `pnpm start`.
