# Testing Swift projects with Atrium

Tier 1 of Atrium's Swift story (feat-runner-swift-spm-001): run an SPM
package's `swift test` in a Linux container and feed the results into the same
Tests tab + review gate every other suite uses. Works on any machine with
Docker — **no Mac required**. (Tier 2, XCUITest over SSH to a Mac, is a
separate future task.)

## What a Swift project needs

1. Docker running, with the Swift image pulled once:

   ```
   docker pull swift:6.0
   ```

2. An `atrium.tests.json` at the repo root:

   ```json
   {
     "suites": [
       {
         "id": "swift-unit",
         "label": "Swift unit tests",
         "runner": "command",
         "command": "swift test --parallel --xunit-output junit.xml",
         "report": "junit-xml",
         "reportPath": "junit.xml",
         "target": "container:swift:6.0"
       }
     ]
   }
   ```

3. Run it against a task:

   ```
   atrium_run_tests { task: "feat-my-swift-001", suite: "swift-unit" }
   # or
   ATRIUM_API_TOKEN=... node backend/scripts/run-e2e.js --task feat-my-swift-001 --project-dir C:/path/to/swift-repo --suite swift-unit
   ```

Results land on the task exactly like Playwright: `e2e_run` (per-test rows
from the xunit XML), `e2e_status` passing/failing, `e2e_suite`, and uploaded
artifacts (`junit.xml` + the full build/test log) in the Tests tab.

A working example lives in `samples/swift-demo/` — including a
`swift-unit-fail-demo` suite that sets `DEMO_FAIL=1` to prove the red path.

## How the container run works (and its limits)

The runner drives the Docker Engine API directly (`backend/runners/containerJob.js`):

- **create** an ephemeral `atrium-job-*` container from the suite's image with
  the project bound **read-only** at `/src`
- the job **copies `/src` to a writable `/work`** and runs the command there
  (Swift builds need a writable tree; nothing is ever mounted writable)
- the report file is printed between sentinel markers and travels back over
  the **logs** stream — no exec, no writable mounts, no docker-cp
- **wait** (15-minute cap), then the container is **force-removed** — nothing
  survives the run

On the **host** (the usual agent context) this talks straight to Docker
Desktop / the local socket. Inside the **Atrium container** it goes through
the socket allow-list proxy, which only permits this exact shape — set
`ATRIUM_RUNNER_IMAGES=swift:6.0` (and `ATRIUM_RUNNER_WORKSPACE` to your
projects root) in `.env` to enable it there; empty means off. See
`docs/install.md` for the precise residual capability that grants.

Notes and limits:

- The first run per project is slow (`swift build` from scratch — the
  writable `/work` copy starts cold every run; there is no build cache yet).
- SPM packages with external dependencies need network: jobs run on the
  default bridge network, so dependency resolution works.
- **`--parallel` is required** — SwiftPM only writes the `--xunit-output`
  file when tests run in parallel mode (verified on swift:6.0; without it the
  tests run but no XML appears and the suite errors with "exited 0 without
  emitting its JUnit report").
- `--xunit-output` writes results for passes AND failures; the parsed XML
  decides the run's status (self-reported, stamped with `source: junit-xml`
  provenance).
- Container targets support `junit-xml` and `exit-code` reports, not
  `playwright-json`.
