# Creator automation progress

User authorization: assistant chooses implementation method and proceeds with scripts / existing code adaptation.

Execution: native inline; existing isolated cloud checkout, feature branch feat/creator-automation. No additional worktree.

Current phase: Tasks 1–5 implemented. Mac source installer prepared; live Mac/platform/model acceptance remains an external deployment prerequisite.

Verified on 2026-10-08:
- Frozen installation: npm ci --cache /tmp/creator-workflow-npm-cache --ignore-scripts --no-audit --no-fund (22 packages).
- npm test: 33 tests passed, 0 failed. Includes real CLI startup/shutdown, HTTP state persistence, concurrent material saves, source identity checks, null metrics, delayed observations, queue rotation and process cancellation.
- npm run check: JS, JSON schemas, shell syntax, actual dependency entrypoints and Codex noninteractive flags.
- Actual Chromium workbench: overview, default Playwright settings, tabs and note submission. Visual screenshot inspected; test data stayed in /tmp and is excluded from distribution.
- npm run pack:mac: valid ZIP, 24 source files, executable Mac entrypoints, no data/node_modules/credentials. SHA256 accompanies the ZIP.
- Fresh code review identified five substantive defects, all reproduced and fixed: launchd PATH, OpenCLI row formats, lost concurrent writes, all-null review windows and starving source queues. Targeted follow-up confirmed fixes, with no material new finding.

Reusable cloud draft: install_script and start_skill saved additively; previous network policy and browser instructions retained. Draft is not published. No Mac credentials supplied to cloud configuration.

Remaining acceptance: user installs on their Mac, supplies the current extension token locally, performs normal platform login, and runs first collection and first content pack. The current web chat has no remote trigger bridge to that Mac.

Preflight: Task 2 consumes Task 1 source IDs and normalized metrics; Task 3 consumes both providers and Store; Task 4 consumes Workflow and scheduleDue. Interfaces named consistently in the plan.

Deployment boundary: current cloud session cannot install on the user's Mac. Packaging and automated local tests are possible here; real browser acceptance requires the one-time Mac install.
