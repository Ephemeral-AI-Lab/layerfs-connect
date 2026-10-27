// The user's request that opens each demo's root conversation (scenario.json's
// `prompt`). Connect's own: dsh-layerfs's scenarios and the recordings have
// none. port-scenarios.mjs and replay/convert.mjs write it after the blurb.
export const ROOT_PROMPTS = {
  tour:
    "Build the small site on a feature-home Branch: edit the home page, add an about page, install and build it in a Workspace (fix the build if it fails), run the server and check it, then publish feature-home and a header Branch to main.",
  parallel:
    "Split the header and footer work between two subagents, each on its own Branch forked from main. Have them write their component and run the tests, then publish both to main without losing either one.",
  conflicts:
    "Change the page heading on feature, and resolve whatever conflicts that causes with the edits already on the Branch and on header. Keep our line, then merge feature and header and publish the result.",
  merge:
    "Work on two Branches: commit from a Workspace that has gone stale, fix any Conflict an edit to the same line causes, merge the two Branches into a new one, fix the merge conflict on its source Branch and publish the result.",
  sandbox:
    "Use one Sandbox for both the site and the docs Branches. Run the slow site build in the background while you update the docs, then tear everything down cleanly: unmount both Workspaces and close the Sandbox.",
  agents:
    "Fork checkout and search from main and hand the work to five subagents, one command at a time: three on checkout and two on search. Have them commit as they go, resolve any conflicts, then merge, build, test and publish the result.",
  checkpoints:
    "Build up main in four ranges. In each range have two subagents fork lanes of their own and write a folder of two files each, then merge the lanes, publish the range and check that main lists every file written so far.",
  shop:
    "Grow the web shop from its skeleton over six milestones: a product catalog, carts and totals, checkout with orders and discounts, a browser storefront and an admin page. Install, build and test each milestone in a Workspace and publish it to main.",
  depot:
    "Write Depot, a Rust inventory service: a Cargo workspace with domain, store, HTTP server and CLI crates, plus a browser client. Build and test it milestone by milestone, run the acceptance tests against the server, and finish with a clean release candidate on main.",
  crew:
    "Build an issue-tracking application with five agents: people and organizations, work boards, search and insight. Give each lane its own Branches, have them install, build and test their code, merge the lanes into integration Branches, check them and publish to main.",
}
