#!/usr/bin/env node
// Back-compat shim (feat-runners-core-001). The Playwright-only logic that
// lived here was generalized into backend/runners/ — playwright.js keeps the
// exact old behavior as the default suite, junitCmd.js adds JUnit-XML and
// exit-code suites, index.js orchestrates + uploads + writes back to the task.
//
// Old invocations keep working unchanged:
//   ATRIUM_API_TOKEN=<jwt> node backend/scripts/run-e2e.js --task <task-id> [--filter <grep>]
// New flags: --suite <id> --project <name> --project-dir <path>  (see
// atrium.tests.json in docs/agents.md).

require('../runners').cli();
