# Testing any JUnit-emitting stack with Atrium

The generic path (feat-runner-junit-001): **any command that writes a JUnit
XML report** feeds Atrium's Tests tab and review gate — gradle (Java/Android),
dotnet, pytest, Node's built-in test runner, and most Electron/JS frameworks
all emit it. Swift has its own page (`docs/testing-swift.md`); this one covers
everything else.

## The recipe

One suite in your repo-root `atrium.tests.json`:

```json
{
  "suites": [
    { "id": "unit", "label": "Unit tests",
      "runner": "command",
      "command": "<your test command that writes junit.xml>",
      "report": "junit-xml",
      "reportPath": "junit.xml",
      "target": "local" }
  ]
}
```

Commands per stack (each verified shape has parser test coverage):

| Stack | Command |
|---|---|
| Node (built-in, zero deps) | `node --test --test-reporter junit --test-reporter-destination junit.xml` |
| pytest | `pytest --junitxml=junit.xml` |
| gradle | `gradle test` then point `reportPath` at `build/test-results/test/TEST-*.xml` (single file) — or merge, see note |
| dotnet | `dotnet test --logger "junit;LogFilePath=junit.xml"` (needs the `JunitXml.TestLogger` NuGet package) |

Run it: `atrium_run_tests { task: "<task-id>", suite: "unit" }`. Results land
as `e2e_run` rows + `e2e_status` + uploaded artifacts, identical to Playwright.

## local vs container targets

- `target: "local"` runs the command on the machine driving the tests —
  simplest when the toolchain is installed.
- `target: "container:<image>"` runs it in an ephemeral container (see
  `docs/testing-swift.md` for the full mechanism: read-only source bind,
  writable internal copy, report returned over the logs stream, container
  force-removed). Works for any image: e.g.
  `"command": "pip install -q pytest && pytest -q --junitxml=junit.xml"`,
  `"target": "container:python:3.12-slim"`. Pre-pull the image; when running
  from inside the Atrium container, the image must also be on
  `ATRIUM_RUNNER_IMAGES`.

A working two-stack example lives in `samples/junit-demo/` — a Node suite
(local target, plus a `DEMO_FAIL=1` red-path variant) and a pytest suite
(container target).

## Notes

- **Windows + `target: local`**: commands run through `cmd.exe`, so POSIX
  `VAR=1 command` env-prefixes silently don't apply (found the hard way — the
  var is ignored and the command still runs). Inside `container:` targets
  commands run under bash, where prefixes work. For a portable local toggle,
  select different test files per suite instead (see the sample's
  `fail-demo.test.mjs`).
- `reportPath` is a single file today. Tools that write one XML per class
  (gradle's default) should either name one file or merge; a glob/multi-file
  reportPath is a natural follow-up if a real project needs it.
- `<error>` elements count as failures (a crash is not a pass); `<skipped>`
  counts as skipped; times sum into per-test durations.
- The run stays self-reported and is stamped with provenance:
  `e2e_run.source: "junit-xml"` + `e2e_suite`.
