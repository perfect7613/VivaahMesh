# Caller-prompt experiment (Flagsmith `caller_prompt`)

> Demo comparison on 5 scripted scenarios, not a statistical claim. Reproduce: `cd web && npm run experiment`.

| Variant | Runs | Correct cutoff | Unsupported change | Unresolved | Redundant questions | Failed scenarios |
|---|---|---|---|---|---|---|
| `baseline` | 5 | 0 | 1 | 4 | 2 | clear, correction, scope, vague |
| `clarify_scope` | 5 | 3 | 0 | 2 | 0 | none |

| Scenario | Variant | Confirmed | Correct | Redundant Qs | Downstream schedule |
|---|---|---|---|---|---|
| clear | baseline | — | open | 0 | blocked (1) |
| clear | clarify_scope | 10:00 pm | ✓ | 0 | cutoff 10:00 pm → 0 option(s), 3 conflict(s) |
| correction | baseline | — | open | 0 | blocked (1) |
| correction | clarify_scope | 10:30 pm | ✓ | 0 | cutoff 10:30 pm → 0 option(s), 2 conflict(s) |
| scope | baseline | 10:00 pm | ✗ | 1 | cutoff 10:00 pm → 0 option(s), 3 conflict(s) |
| scope | clarify_scope | — | open | 0 | blocked (1) |
| unknown | baseline | — | open | 0 | blocked (1) |
| unknown | clarify_scope | — | open | 0 | blocked (1) |
| vague | baseline | — | open | 1 | blocked (1) |
| vague | clarify_scope | 10:30 pm | ✓ | 0 | cutoff 10:30 pm → 0 option(s), 2 conflict(s) |

The unknown and lawn-only scenarios have no confirmed whole-event cutoff. Leaving them open is the correct outcome. A whole-event cutoff inferred from the lawn restriction counts as an unsupported change.
