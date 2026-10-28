# Models dialog

Settings for the model providers that live sessions may use, and the default model. Opens from:
the sidebar's Models row.
Source: `src/renderer/src/components/models/models-dialog.tsx` (every region is in this file).

## Skeleton

```text
+-[1] Settings nav --+-[2] Models -------------------------------------------------------------+
|                    | Models                                                                x |
| Settings           | Enter your API keys to use models from these providers. Live            |
|                    | sessions run on the default model.                                      |
| > Models           | +-[3] DefaultModel ---------------------------------------------------+ |
|                    | | Default model                                                       | |
|                    | | Model                                              Thinking         | |
|                    | | [ GPT-6.1 Sol                              v ]     [ medium     v ] | |
|                    | +---------------------------------------------------------------------+ |
|                    | +-[4] ProviderRow ----------------------------------------------------+ |
|                    | | OpenAI Codex (ChatGPT plan)  * Signed in         [ Edit ]  Sign out | |
|                    | +---------------------------------------------------------------------+ |
|                    | +-[5] Add model provider ---------------------------------------------+ |
|                    | |                        + Add model provider                         | |
|                    | +---------------------------------------------------------------------+ |
|                    |                                                                         |
|                    |                                                                         |
|                    |                                                                         |
+--------------------+-------------------------------------------------------------------------+
```

Adding a provider (Add model provider pressed; Edit on a row opens the same editor inside that row):

```text
+-[6] AddCard ---------------------------------------------------------------+
| (*) Third-party model provider   ( ) Custom model API                      |
| Pick OpenAI, Anthropic, Kimi or another provider from the built-in         |
| catalog and enter its API key.                                             |
| Provider                                                                   |
| [ Anthropic                  v ]                                           |
| +-[7] ProviderEditor ----------------------------------------------------+ |
| | +-[8] SignInPanel ---------------------------------------------------+ | |
| | | Anthropic (Claude Pro/Max)                 [ Sign in with Claude ] | | |
| | | Use your subscription. Connect gets its own sign-in;               | | |
| | | other apps on this machine stay signed in.                         | | |
| | +--------------------------------------------------------------------+ | |
| | Or use an API key (?)                                                  | |
| | [ Leave blank to use the environment (ANTHROPIC_API_KEY)             ] | |
| | Env var not detected. Enter an API key, or set ANTHROPIC_API_KEY in... | |
| | ---------------------------------------------------------------------- | |
| | > Customized settings                                                  | |
| | ---------------------------------------------------------------------- | |
| |                                                   [ Cancel ]  [ Save ] | |
| +------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------+
```

## Regions

1. **Settings nav** (`ModelsDialog`, `models/models-dialog.tsx`): the "Settings" title and one item, Models, which is always active.
2. **Models header** (`ModelsDialog`, `models/models-dialog.tsx`): "Models", the description, and the dialog's close x.
3. **Default model** (`DefaultModel`, `models/models-dialog.tsx`): two selects, saved as soon as either changes.
   - Model: the models of every provider with a key, grouped by provider.
   - Thinking: the model's thinking levels; it is disabled when there is only one.

   A red dot warns when the default's provider has no key, and a spinner shows while it saves.
4. **Provider rows** (`ProviderRow`, `models/models-dialog.tsx`): one per configured provider: its name, a "Custom" tag for custom endpoints, and the key state with a dot. The key state reads Signed in, API key saved, From <ENV_VAR>, Configured, Uses its own credentials, or API key missing (red). On the right are Edit and Delete, or Sign out for a signed-in provider. A provider with a sign-in and no key shows its sign-in button (e.g. "Sign in with ChatGPT") in place of Edit. Delete asks to confirm inline, for example "Delete X?", "Sign out of X?" or "Remove X? Connect will ignore ENV_VAR.". After a save the row shows "Saved". Edit opens the editor (7, or the custom editor) under the row; one editor is open at a time.
5. **Add model provider** (`ModelsDialog`, `models/models-dialog.tsx`): a dashed button that opens the add card (6) in its place.
6. **Add card** (`AddCard`, `models/models-dialog.tsx`): a two-way switch, "Third-party model provider" or "Custom model API", with a line about each.
   - The catalog way picks a Provider (common ones first) and shows its editor (7).
   - The custom way shows `CustomEditor`: Provider ID, Display name, API protocol, Base URL, API key and Models (one ID per line), saved with "Create provider".
7. **Provider editor** (`ProviderEditor` in `EditorShell`, `models/models-dialog.tsx`): the API key field ("Or use an API key" when the provider has a sign-in). The key is write-only: it starts empty, and blank keeps what is stored. A line under it says whether the env var is detected. "Customized settings" folds out the Base URL and the provider's model list. Cancel and Save sit at the bottom.
8. **Sign-in panel** (`SignInPanel`, `models/models-dialog.tsx`): for subscription providers: the plan name, a note, and "Sign in with ..." ("Sign in again" once signed in).

## States

- **Loading**: "Reading the providers..." with a spinner. On error: "Loading the providers failed: ..." with Retry.
- **No usable provider**: the Default model card reads "Add a provider with an API key below, then choose the model live sessions use." In place of the selects. The Model select offers "Choose a model..." when there is no default.
- **Signing in** (inside 8, while it runs, with Cancel in place of the sign-in button):
  - Choose "How to sign in": Browser or Device code.
  - Device code: the code (with a copy button), "Open <host>", and "Waiting for you to approve it...".
  - Browser: "Your browser opened <host>...", "Open again", "Waiting for the browser...", and a field to paste the callback address with Submit.
  - A failure shows "Sign-in failed: ...". Closing the editor or the dialog cancels a running sign-in.
- **Saving**: the save button reads "Saving..." and errors show in red under the fields. The custom editor checks the Provider ID ("Start with a lowercase letter..." / "A provider already uses this ID.") and needs a Base URL and at least one model.
