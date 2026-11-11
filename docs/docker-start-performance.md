# Docker worker startup performance — 2026-11-09

## Measured result

| Path | Elapsed |
| --- | ---: |
| Replacement start with default image import | 30,119 ms |
| Fresh disposable home, explicitly selecting already-loaded image | 456 ms |
| Stop/start in that disposable home with selected image | 422 ms |
| Start when its worker already answers | 102 ms |

The running Connect preview was not stopped for this benchmark. A separate
Disposable SQLite home and its worker were used; its Store, container, Docker
data volume and home were removed after the checks. No production image setting
was changed.

The replacement CLI started at 12:24:24.423 UTC. Docker created its container at
12:24:54.054597337 UTC, started it at 12:24:54.220459421 UTC, and the CLI returned
success at 12:24:54.542 UTC. Approximately 29.632 s elapsed before container
creation, 166 ms from creation to start, and 322 ms afterward. The original
receipt has no image-import phase timestamps, so the entire pre-create interval
must not be claimed as a precisely measured `docker load` duration.

## Cause

`layerfs-machine/src/image.rs::docker_default` reuses `loaded_image.id` only
when `loaded_image.bundle` equals the entire sealed bundle hash. A fresh home
or worker/daemon/helper rebuild therefore imports the archive again, even if
the base image already exists in the selected Docker engine. The new and old
bundles have different hashes but the same manifest `image` digest. The archive
is 2,747,719,680 bytes.

The platform then removes an existing worker container, creates a new one,
writes its secret, and checks readiness in 200 ms intervals. Those steps are
already subsecond in the measured image-reuse path. Reducing readiness polling
is not the main opportunity.

## Recommended optimization

In LayerFS, reuse the installed Docker image by image content identity instead
of whole-bundle identity, and validate its presence in the selected Docker
engine before returning it. Keep worker protocol/bundle compatibility checks:
worker binaries can change while their container image remains unchanged.

Share the content-to-engine-image mapping across homes, scoped to Docker engine
and platform. Keep each home's worker and data volume separate. Import only
when that specific image is missing; do not introduce automatic worker start,
automatic mutation retries, or fallback to an unrelated image.

Use Docker's actual returned image ID. Here the bundle manifest names
`sha256:1d91885de27a20805af0d1b99602ace066f0514983613e391ee1f73ac8e7c2e9`,
which `docker image inspect` cannot resolve; the engine's imported image is
`sha256:50e8f040592a52a0e9385b7a683c8ab455d391be50733a0dbf65edf9faeb0540`,
which resolves in 42 ms. A naive manifest-digest-only existence check would
still import unnecessarily on this engine.

## Supported immediate option

`machine.update docker --image <existing Docker image ID>` bypasses the default
archive-loading path. The benchmark used this supported call in its disposable
home. It explicitly pins the machine image, so future intended base-image
changes require updating the pin. It should not be silently applied as a
permanent substitute for fixing the image cache.

The current preview retains its existing home and now has the matching
`loaded_image.bundle` recorded. Ordinary subsequent starts should already take
the cached-image path unless the bundle/home changes or the Docker cache is
removed. No stop/start of the current preview was needed for this conclusion.
