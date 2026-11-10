# CLI Activity

```text
+--------------------------------------------------------+
| CLI Activity                    Refresh   Export shown |
| Actions, commands, and their output.                   |
+--------------------------------------------------------+
| Search activity     All outcomes      Desktop actions  |
| Action title / target       Time / commands / outcome  |
| Action title / target       Time / commands / outcome  |
|                                      Older activity   |
+--------------------------------------------------------+

+--------------------------------------------------------+
| CLI Activity                    Refresh   Export shown |
| < All activity                                         |
| Action / target                              Outcome   |
| Commands: select one to inspect                         |
| CLI input                                 Copy command |
| Output | Standard error | Details                      |
| Captured output, byte counts and truncation state      |
| > Action details                                       |
+--------------------------------------------------------+
```

1. Machine progress links directly to its action ID.
2. Viewing, refreshing and exporting never replay a command.
3. Status and source filters apply to the list; export contains shown records.
4. Output uses the host recorder's credential redaction and byte bounds.
5. Empty, expired and failed reads retain explicit feedback and refresh.
6. Preset operations and history clearing are outside this publication.
