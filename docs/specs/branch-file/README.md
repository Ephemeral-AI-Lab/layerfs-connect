# Branch and file SDK implementation specifications

Status: proposed work, not implemented. Based on `layerfs_v2_0_0` at `716197c4999fb087aa0fb17bac5ceb48b0b556ae` (2026-11-08).

Parent task: https://github.com/Ephemeral-AI-Lab/layerfs-project/issues/128

Project board: https://github.com/orgs/Ephemeral-AI-Lab/projects/2/views/2

| Specification | Scope |
| --- | --- |
| [Shared contract](contract.md) | Saved references, page-based queries, coverage, scope and decision gate |
| [Branch](branch.md) | Saved history, publication details and mixed-version attribution-aware comparison |
| [File](file.md) | Revisions, aligned attribution, blame and bounded saved reads |

## Issue tree

- [Branch/file: define saved references, page-based queries, coverage and scope](https://github.com/Ephemeral-AI-Lab/layerfs-project/issues/129) — API, Decision
- [Branch: expose saved commits and details including main publications](https://github.com/Ephemeral-AI-Lab/layerfs-project/issues/130) — API, Feature
- [Branch diff: compare pinned Commit/Layer endpoints and discover attribution-only paths](https://github.com/Ephemeral-AI-Lab/layerfs-project/issues/131) — Engine, Feature
- [File: add saved path revisions with metadata and identity changes](https://github.com/Ephemeral-AI-Lab/layerfs-project/issues/132) — Engine, Feature
- [File diff and blame: return aligned attribution and bounded saved reads](https://github.com/Ephemeral-AI-Lab/layerfs-project/issues/133) — Engine, Feature
- [Branch/file: publish SDK/CLI contracts and verify compatibility across Store backends](https://github.com/Ephemeral-AI-Lab/layerfs-project/issues/134) — API, Verification

The issue bodies embed the substantive specs so remote tasks do not depend on uncommitted local files. Shared-contract choices are prerequisites, not approved design decisions. Task tracking lives in layerfs-project; implementation remains in layerfs, and qualification harnesses/receipts follow layerfs-benchmark policy.

Connect integration is outside this task. #135 was closed as not planned and removed from the parent and project.
