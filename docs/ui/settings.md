# Settings

Source: `components/settings/*`, `chat/model-sign-in.tsx`, `chat/request-headers.tsx`
(under `src/renderer/src`)
Opens from: the sidebar's Settings (last section; Models at first); "Manage models..." in a chat
opens Models (`useSettings().open(section)`).

## Dialog

```text
+-[1] Nav -------------+-[2] Header -----------------------------------------------------+
| Settings             | Models                              [3 Open config file]    [x] |
|                      +-----------------------------------------------------------------+
|  <gauge>  Runs       | [4] Body: the section, scrolls on its own                       |
|  <pkg>    SDKs       |                                                                 |
|  <wrench> Tools      |                                                                 |
|  <hook>   Hooks      |                                                                 |
| (<db>     Models )   |                                                                 |
|  <bot>    Agents     |                                                                 |
|  <gear>   General    |                                                                 |
|  <slash>  Commands   |                                                                 |
|  <puzzle> Extensions |                                                                 |
+----------------------+-----------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `nav.st-nav` | settings-dialog.tsx:47 | Sorted by translated label length (English shown) |
| 2 | `.st-header` | settings-dialog.tsx:64 | Section title, actions, Close |
| 3 | header actions | settings-dialog.tsx:66 | Models: Open config file; SDKs: Open sdks.json |
| 4 | `.st-options` | settings-dialog.tsx:69 | The section component |

A failed open shows "Could not open the config file" / "Could not open sdks.json" beside it.

## General

```text
Make Connect feel at home. Changes take effect immediately.
+-[1]--------------------------------------------------------------+
| Language                                         [v English    ] |
| Interface language                                               |
+------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `GeneralSection` | settings-dialog.tsx:104 | English or Simplified Chinese; applies at once |

## Models

```text
Enter your API keys to use models from the following providers.
[1] Saved Anthropic (anthropic).
+-[2]--------------------------------------------------------------+
| Anthropic  *                                     [Edit] [Delete] |
+------------------------------------------------------------------+
| acme-gateway  ( Custom )  *                      [Edit] [Delete] |
+------------------------------------------------------------------+
| <provider>  (* Signed in)                      [Edit] [Sign out] |
+------------------------------------------------------------------+
[3 + Add model provider ]     dashed; becomes the Add card
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | saved line | models-section.tsx:121 | "Saved {provider}." after a save or add |
| 2 | provider rows | models-section.tsx:123 | Dot: "API key configured" / "API key missing" |
| 3 | `.st-add` | models-section.tsx:244 | Opens the Add card, closes any editor |

Edit opens the provider editor under its row, one at a time. Delete / Sign out opens the confirm.

### Provider editor

```text
+-[1] Anthropic  anthropic ----------------------------------------+
| +-[2] only with a sign-in ------------------------------------+  |
| | <login> <plan> (* Signed in)    [Sign out] [Sign in again]  |  |
| | Connect has its own sign-in; other apps on this machine     |  |
| | stay signed in.                                             |  |
| +-------------------------------------------------------------+  |
| [3] API key                          ("Or use an API key")       |
| ~~~ Leave blank to use saved credentials ~~~_________ [<eye>]    |
| API key configured                                               |
| [4] v Customized settings                                        |
|   Display name  ~~~ acme-gateway ~~~_____________  (custom only) |
|   Base URL      ~~~ https://gateway.example/v1 ~~~__________     |
|                 Leave blank to use the provider's endpoint.      |
|   API protocol  [v OpenAI Chat Completions ]       (custom only) |
|   [5] Request headers - optional                           [v]   |
|   [6] Model list                                                 |
| [7] Model 2: Model ID must be unique.                            |
|                                            [Cancel]  [Save]*     |
+------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `ProviderEditor` | provider-editor.tsx:92 | Name, then id when different |
| 2 | `ModelSignIn` | provider-editor.tsx:98 | Signed out: the plan's sign-in button |
| 3 | `ApiKeyInput` | parts.tsx:18 | Eye once typed; else "Enter your API key" |
| 4 | Customized settings | provider-editor.tsx:122 | Folded; open when adding a custom one |
| 5 | `RequestHeaders` | request-headers.tsx:28 | Name / Value rows, x, eye, Add header |
| 6 | `ModelListEditor` | provider-editor.tsx:158 | See "Model list" |
| 7 | problem / failure | provider-editor.tsx:170 | URL or model problem; Save off |

API protocol: OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, Google Gemini.
No headers: "No custom headers." Save busy: "Saving...".

### Model list

```text
+-[1] Model list ------------------------------ [Fetch available models] -+
| 3 built-in models are always available; models listed here are added    |
| to them.                                                                |
| [2] __<model-id>__________  __Display name______   [v]  [<trash>]       |
|   [3] Context window     ~~~ Uses the provider default ~~~__            |
|       Max output tokens  ~~~ Uses the provider default ~~~__            |
|       Image input        Unknown - images allowed                       |
|       [ ] Supports reasoning                                            |
|     __Model ID__________  __Display name______   [>]  [<trash>]         |
| [4 + Add model]                                                         |
| [5] Model capabilities refreshed.                                       |
+-------------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `ModelListEditor` | model-list.tsx:140 | Fetch off without a base URL; busy text |
| 2 | model row | model-list.tsx:162 | ID, name, Model options, Delete model |
| 3 | advanced | model-list.tsx:184 | 131072 / 256K / 1M; image input as the API says |
| 4 | Add model | model-list.tsx:209 | Empty row; its ID takes focus |
| 5 | notice / failure | model-list.tsx:216 | Or "The provider listed no models. ..." |

Built-in count line only for a built-in provider. Empty: "No models will be shown in the selector."

### Add model provider card

```text
+-[1]--------------------------------------------------------------+
| [ Custom model API | |Third-party model provider| ]              |
| Pick OpenAI, Anthropic, Kimi, or another provider from the       |
| built-in catalog and enter its API key.                          |
+-[2] Third-party -------------------------------------------------+
| Provider  [v <provider>                                    ]     |
| provider editor without its title: sign-in, API key,             |
| Customized settings, [Cancel] [Save]*                            |
+------------------------------------------------------------------+

+-[3] Custom ------------------------------------------------------+
| Connect a relay, a self-hosted server, or any other OpenAI- or   |
| Anthropic-compatible endpoint by its base URL, protocol, and     |
| models.                                                          |
| Provider ID    ~~~ acme-gateway ~~~__________________________    |
|   Lowercase identifier, starting with a letter, that uniquely    |
|   names this provider in requests and as its credential name.    |
| Display name   ______________________________________________    |
| Base URL       ~~~ https://gateway.example/v1 ~~~____________    |
| API protocol   [v OpenAI Chat Completions                  ]     |
| API key        ~~~ Enter your API key ~~~____________________    |
| Model list (as above, no built-in line)                          |
| A custom provider needs a base URL.                              |
|                                   [Cancel]  [Create provider]*   |
+------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | mode tabs | models-section.tsx:182 | Third-party off when every provider is set up |
| 2 | catalog panel | models-section.tsx:205 | Unset built-ins, A-Z; Save needs a key or change |
| 3 | `CustomProviderCard` | custom-provider.tsx:66 | Bad or taken ID: an error line |

The tabs sort by label length; Third-party is chosen first. After adding with no model chosen yet,
new chats get the provider's first model.

### Fetch available models

```text
+-[1] Choose models to add --------------------------------+
| These are the models this provider has available.        |
| Choose the ones to add.                                  |
| ~~~ Search models ~~~_________________     [Select all]  |
| [x] <model-id-1>                                         |
| [ ] <model-id-2>                                         |
| ...                                                      |
|                              [Cancel]  [Add selected]*   |
+----------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `SmallModal` | model-list.tsx:218 | New models only; "No matching models."; Deselect all |

### Delete / sign-out confirm

```text
+-[1] Delete Anthropic (anthropic)? -------------------------------+
| Deleting Anthropic (anthropic) removes its configuration and     |
| stored API key.                                                  |
| <error>                                                          |
|                     [Cancel]  [Delete Anthropic (anthropic)]     |
+------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `SmallModal` | models-section.tsx:262 | Signed in: "Sign out of {provider}?", [Sign out] |

## Runs

```text
How every chat's runs handle slow commands and failed model requests. Changes apply to each
chat's next run.
+-[1]--------------------------------------------------------------+
| Command timeout (seconds)                              [   900 ] |
| Default for a shell command that sets no timeout of its own.     |
| Default 900.                                                     |
| Automatic retries                                      [     2 ] |
| Retries after a failed model request. 0 turns retries off.       |
| Default 2.                                                       |
+------------------------------------------------------------------+
[2] Use whole numbers within each field's range.
[3] Wait for running chats to finish, or stop them, before changing run limits.
                                        [Reset to defaults]  [Save]*
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `RunsSection` | runs-section.tsx:62 | 1-86400 s, 0-5; polls every 2 s while chats work |
| 2 | invalid line | runs-section.tsx:85 | Save off |
| 3 | busy notice | runs-section.tsx:86 | Save off; after a save: "Run limits saved" |

## Agents

```text
Who does the work in a chat, and what each one gets. Switches here apply to one agent; Tools and
Hooks switch them for all agents.
+-[1]--------------------------------------------------------------+
| Worker  ( connect-worker )                         <lock> [=o]   |
| A focused subagent for one bounded piece of the task. It cannot  |
| start other agents.                                              |
|   Started by    The main agent or a lead                         |
|   Model         Its parent's                                     |
|   Instructions  Stay within the assigned files, verify the ...   |
|   Extensions    `LayerFS Connect` `pi-subagents`                 |
|   [2] Tools     `bash`                                <lock> [o] |
|                 `contact_supervisor`                         [o] |
|   [3] Hooks     LayerFS Connect                                  |
|                 `before_agent_start` Adds project ...        [o] |
|                 pi-subagents                                     |
|                 `before_agent_start` Marks where ...  <lock> [o] |
|   pi-subagents' child runtime also enforces tool budgets ...     |
|   Always available while subagent is on                          |
+------------------------------------------------------------------+
| Main agent ...                                                   |
| Lead  ( connect-lead ) ...                                       |
+------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `CapabilityRow` | agents-section.tsx:22 | Main agent, Worker, Lead; a lock's reason below |
| 2 | `SwitchList` | agents-section.tsx:38 | This agent's tool switches |
| 3 | `AgentHooks` | agents-section.tsx:53 | By extension; over 6, all locked: one line |

## Extensions

```text
Pi extensions loaded into every chat. Each one brings tools, hooks and commands; turning one off
removes all of them.
+-[1]--------------------------------------------------------------+
| LayerFS Connect  ( 0.1.0 ) ( Built in )            <lock> [=o]   |
| The gated bash tool, project instructions and LayerFS            |
| checkpoints. Chats cannot run without it.                        |
|   Tools     `bash`                                               |
|   Hooks     `5 events`                                           |
|   Commands  None                                                 |
|   Required: it provides bash and the permission gate             |
+------------------------------------------------------------------+
| pi-subagents  ( 0.84.0 )                                  [=o]   |
| Child agents (connect-worker and connect-lead), background runs  |
| and supervision.                                                 |
|   Tools     `subagent` `bg_wait` `subagent_supervisor` ...       |
|   Hooks     `17 events`                                          |
|   Commands  Its slash commands are turned off in Connect         |
+------------------------------------------------------------------+

+-[2] Turn off pi-subagents? --------------------------------------+
| Chats lose its tools (subagent, bg_wait, subagent_supervisor,    |
| contact_supervisor) and its 17 hooks. Each chat starts its agent |
| again on its next message; history and files stay as they are.   |
|                                         [Cancel]  [Turn off]     |
+------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `CapabilityRow` | extensions-section.tsx:23 | On applies at once; off asks first |
| 2 | `SmallModal` | extensions-section.tsx:43 | alertdialog; Turn off is the danger button |

## SDKs

```text
Libraries the agents can work with. Each one that is on goes into the instructions of the agents
it lists, with its calls. They are kept in sdks.json; edit it to add an SDK or change one.
+-[1]--------------------------------------------------------------+
| LayerFS  ( Found )                                        [=o]   |
| Projects, Branches, Commits, files, Sandboxes and Workspaces ... |
|   Packages  `layerfs`                                            |
|   Command   `layerfs`                                            |
|   Docs      `README.md`                                          |
|   Agents    Main agent - Worker - Lead                           |
|   Source    ../layerfs-v2-merge/api                              |
|   [2] Calls n                                                    |
|       > project  4                                               |
|       v branch   n                                               |
|           layerfs.branch.list(project, { page_size, page_pos })  |
|           a project's Branches                                   |
|       ...                                                        |
+------------------------------------------------------------------+
[3] This is Connect's built-in list. Open sdks.json to keep your own copy.
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `CapabilityRow` | sdks-section.tsx:62 | Version, Found / Missing; Missing facts list gaps |
| 2 | `SdkCalls` | sdks-section.tsx:91 | A fold per call group: signature, description |
| 3 | built-in hint | sdks-section.tsx:85 | Without a custom sdks.json |

Empty: "No SDKs in sdks.json." A bad file shows its error above the list.

## Tools

```text
What the agents can call. A switch here applies to all agents; one agent's switches are in Agents.
+-[1] LayerFS Connect  0.1.0 -------------------------------------1+
| `bash`                                             <lock> [=o]   |
| Runs a shell command in the workspace. All file reading, ...     |
|   Used by     `Main agent` `Worker` `Lead`                       |
|   Parameters  `command` `timeout`                                |
|   Required: it is the agents' only tool for files and commands   |
+-[1] pi-subagents  0.84.0 ---------------------------------------4+
| `subagent`  [2 ( Off for Lead )]                          [=o]   |
| Starts child agents for focused pieces of the task.              |
|   Used by     `Main agent` `Lead`                                |
|   Parameters  `agent` `task` `workflow` ...                      |
| ...                                                              |
+------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `ExtensionGroup` | capability-parts.tsx:30 | Name, version, ( Off ) when off, count |
| 2 | Off-for tag | tools-section.tsx:27 | Agents that turned it off in Agents |

## Hooks

```text
The agent events each extension handles. A switch here applies to all agents; pi-subagents' hooks
switch with it in Extensions.
+-[1] LayerFS Connect  0.1.0 -------------------------------------5+
| Prepare a run  `before_agent_start`                       [=o]   |
| Adds project instructions (AGENTS.md, CLAUDE.md) to the system   |
| prompt; workspace notes stay when it is off                      |
| Start or resume a chat  `session_start`            <lock> [=o]   |
| Wires subagent events and limits what child agents may use       |
| Required: it limits what child agents may use                    |
| ...                                                              |
+-[1] pi-subagents  0.84.0 --------------------------------------17+
| Start or resume a chat  `session_start`  ( 2 handlers )   [=o]   |
| A chat's agent starts or resumes                                 |
| Switches with pi-subagents                                       |
| ...                                                              |
+------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `CapabilityRow` | hooks-section.tsx:48 | Title + event id; only one hook switches |

## Commands

```text
Type / in a chat's message box to run one.
+-[1] LayerFS Connect  0.1.0 -------------------------------------6+
| /new                    Start a fresh conversation in this       |
|                         workspace                                |
| /model                  Choose the model for your next message   |
| /workspace              Working directory, project and recent    |
|                         folders                                  |
| /compact                Summarize earlier turns to free context  |
| /stop                   Stop the current turn                    |
| /scenario <name> [-platform <name>]   A new chat plays a ...     |
+-[1] pi-subagents  0.84.0 ---------------------------------------0+
| Its slash commands are turned off in Connect                     |
+------------------------------------------------------------------+
```

| [n] | Component | file:line | one line |
|---|---|---|---|
| 1 | `CommandsSection` | commands-section.tsx:23 | Connect's list is in code; rest: Pi |

## States

```text
Loading       Loading...    (Models: the intro line only)
Load error    Could not load the agent setup: <error>  [Retry]       capability-parts.tsx:13
              Could not load the SDKs: <error>  [Retry]              sdks-section.tsx:48
              Loading the provider directory failed: <error> [Retry] models-section.tsx:100
              Runs: <error>, no Retry                                runs-section.tsx:39
Chat working  "Add login form" is working. Switches wait until it finishes or you stop it.
              "{count} chats are working. ..."; switches off         capability-parts.tsx:19
Saved         Saved. Each chat uses the new setup from its next message.
Change error  <host refusal>; the list reloads                       capability-parts.tsx:24
```

## Notes

- Agent facts, hook purposes and tool notes are host text (`host/agents/capabilities.js`); the
  samples are its defaults. Commands has no "working" notice (`switches={false}`).


## Desktop Models page

Source: `desktop/src/renderer/src/pages/settings/ModelsPage.tsx`,
`ProviderConnection.tsx`, `ProviderSignIn.tsx`.
Opens at `#/settings/models`, from the Settings sidebar or Manage models.
Develop and verify in the web preview at `http://127.0.0.1:1025/#/settings/models`.

```text
Providers & models                                            [Refresh]
Connect a provider, explore its models, and choose a default for new chats.

+-[1] Providers ----------------+-[2] Selected provider --------------------+
| Search providers              | Connection               <status>        |
| Connected                     | [Sign in] (when supported)               |
|   Provider A · Signed in      | > Use an API key instead / Edit connection|
| Available                     |   API key [************************]     |
|   Provider B · Sign in        |   > Advanced connection settings         |
|   Provider C · API key        |   [Connect provider / Save connection]   |
|                               +------------------------------------------+
|                               | [3] Models <count>                       |
|                               | Search models                            |
|                               | Friendly name          [Set as default] |
|                               | model-id · known capabilities            |
|                               | Friendly name                  Default  |
|                               | model-id                                 |
| [+ Add custom provider]       | > Model missing? Enter its ID            |
+-------------------------------+------------------------------------------+
[4] Default for new chats                 [Test default model] [Start a chat]
```

- [1] Providers are visible buttons grouped by credential availability. Search
  matches provider name and ID. Selecting one scopes the model list and clears
  unsaved credentials. Provider selection and Refresh are disabled during
  saves and active sign-in; Cancel sign-in remains available.
- [2] OAuth uses the existing host sign-in flow: device codes, browser approval,
  prompts, polling, cancellation and retry. API keys use the provider-only save
  endpoint; saving credentials does not select a default or send a model request.
  Keys clear after a successful save and remain in the field after a failure.
  Advanced settings hold the endpoint and protocol. Custom providers have a
  focused name, ID, endpoint, protocol, optional key and initial model form.
- [3] Catalog models remain visible before connecting. Rows show display name,
  model ID, and reasoning/image/context metadata only when supplied by the host.
  Model search matches name and ID; empty search and empty catalog states are
  distinct. The list scrolls independently for large catalogs. Selecting a
  default requires an available credential or a configured custom endpoint.
  Unknown model IDs can still be entered explicitly. Local custom endpoints can
  omit an API key. Saving a connection preserves the previous default.
- [4] The default applies to new chats. Test is a separate, explicit action that
  sends a short request to that default and can incur provider usage charges.
  Only a successful test earns "Connection verified"; merely having credentials
  is labeled "Credential available" or "Signed in". Refresh or a configuration
  change clears the verification indicator. Errors show inline and allow retry.

The two panes remain side by side at desktop sizes (900×600 and 1280×820),
and stack when the available content width is below 560px. The existing Settings
sidebar and semantic theme are preserved. New chat reloads the saved host
selection; the composer continues to offer Manage models.


## Desktop Tools, Agents and Hooks

Each secondary Settings page has one content heading and Reload action. There
is no separate top title row. With the sidebar collapsed, the content heading
leaves room for the shared window controls, matching the Models page.

Source: desktop/src/renderer/src/pages/settings/CapabilitiesPage.tsx
Opens from: the secondary Settings sidebar.

```text
+-Settings sidebar---+--[1] Tools / Agents / Hooks ----------------------------+
| Models            | [2] Pi version - Configured setup / Live session        |
| Tools             |     pi-subagents <installed version> - Enabled / Off   |
| Agents            |     Active chats prevent configuration changes         |
| Hooks             |                                                        |
|                   | [3] Tools: extension groups, descriptions, parameters   |
|                   |     Used by: Main agent / Worker / Lead     [On / Off] |
|                   | [4] Agents: Main agent / Worker / Lead                 |
|                   |     Model, instructions, extensions         [On / Off] |
|                   |     > Tools      (individual switches)                 |
|                   |     > Prompt     (configured template, read-only)      |
|                   |     > Hooks      (individual switches)                 |
|                   | [5] Hooks: extension, event, purpose         [On / Off] |
|                   |     Live handler count, or configured-event label      |
+-------------------+--------------------------------------------------------+
```

| Region | Data and behavior |
|---|---|
| [2] | Host capabilities report the installed Pi and subagent package versions |
| [3] | Tool and extension switches use the existing capability configuration API |
| [4] | Prompt text comes from the same builders used to start agents; workspace context is added later |
| [5] | Required hooks are locked; subagent lifecycle hooks switch with pi-subagents |

The Tools page shows pi-subagents installation and extension state. Connect
loads its own connect-worker and connect-lead definitions; packaged workflow
shortcuts and skills are not automatically enabled. The configured setup is
distinct from the live session's tool parameters and hook registrations.
Busy chats disable switches. Server refusals remain visible. No changes are
applied to active agents, and required bash/checkpoint controls stay locked.


## Desktop Configurations

Source: `desktop/src/renderer/src/pages/settings/PiPoliciesPage.tsx`.
Opens from the secondary Settings sidebar at `#/settings/configurations`.

```text
+-Settings sidebar---+--[1] Configurations ------------------------[Reload]--+
| Models             | How agents manage long conversations and errors   |
| (Configurations)      | [2] Context & compaction                          |
| Tools              | Automatic compaction                        [On] |
| Agents             | Reserved tokens                          [16384] |
| Hooks              | Recent tokens to keep                    [20000] |
|                    | Manage models · Hooks                            |
|                    | [3] Retries                                      |
|                    | Automatic retries                           [On] |
|                    | Maximum retries                              [2] |
|                    | Initial delay (ms)                         [500] |
|                    | Maximum delay (ms)                        [5000] |
|                    | [4] Validation / save status                     |
|                    | [Restore defaults]       [Discard] [Save configurations]|
|                    | [5] Preview in Example chat                      |
+--------------------+--------------------------------------------------+
```

1. One page heading; Reload fetches saved settings and active-chat status.
2. Automatic compaction and token budgets map directly to Pi settings.
   Model context limits stay under Models; instruction hooks stay under Hooks.
3. Retry controls govern transient provider failures. Commands/tests are not
   automatically repeated. Maximum retries shares the existing run-limit value.
4. Explicit Save; invalid fields cannot save. Restore defaults edits the draft.
   Saves are refused while any main chat or subagent works. Idle Pi sessions
   reload on their next run. New subagents inherit the private Pi settings.
   Errors preserve the draft and show an alert. Successful saves show status.
5. Links to the existing model-free Example chat. Form rows wrap at narrow widths.
