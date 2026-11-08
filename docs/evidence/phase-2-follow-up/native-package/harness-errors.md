# Retained driver failures

- Initial Electron holder waited for normal app exit for 120 s and timed out. This was a holder harness error; later probes self-quit within a 110 s wall deadline. No native acceptance credited to the timeout.
- Initial explicit Doctor driver used `idempotency_key` instead of supported `key`; native IPC correctly returned InvalidInput; corrected explicit launch retained in development-probe.json.
- packaged-probe.json incorrectly required native state's path prefix for package userData. Actual package userData was isolated; packaged-probe2.json corrects only that assertion.
- packaged-host-route.json assumed only cancelled, but ended is valid after a command already completed.
- packaged-probe3.json used READY output as a running phase, although pinned CLI delivers frames after completion. It also expected private handle from public session view, which omits it. Native retained sandbox/path existed.
- Marker probe4 driver did not catch interrupted HTTP stream immediately; its unhandled rejection prevented final receipt. The actual package host fatal failure was reproduced and retained with corrected driver in packaged-probe5.json and active-boundary-live.log.
- First PG UI report driver had a parse-time quoting typo before app launch; corrected probe2 uses actual DoctorPanel and recorded reports.

None of these failures is relabelled PASS. Probe5 is a genuine Connect host crash on active Stop, separately assigned for repair and verification.
