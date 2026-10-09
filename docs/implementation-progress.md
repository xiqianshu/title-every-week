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

Settings feedback follow-up (2026-10-08): the user's Mac screenshot confirms configuration was saved; live platform collection is still pending. The workbench now shows saved-token status without returning its value, an inline save confirmation, a saving button state and inline failures with the input retained. A real Chromium check reproduces the missing confirmation on the prior UI and passes on the new UI, including refresh persistence and secret exclusion. HTTP checks also confirm an empty token field preserves the existing credential. All 33 tests and the repository check pass after this change.

Collection validation follow-up (2026-10-08): the first Mac collection returned a work-link validation failure. The original response URL is unavailable, so the exact offending page has not been identified. A reproduced defect caused one invalid result to discard the entire Playwright batch. Validation now rejects and reports individual bad rows while retaining valid works, with query parameters excluded from diagnostics; same-platform and published-work identity constraints remain enforced. The collection instructions explicitly distinguish account/search entry URLs from observed work URLs. Regression checks cover a mixed two-platform batch and actual archive/report persistence. All 35 tests and the repository check pass. Live acceptance remains pending after the Mac update.

Workbench updater (2026-10-09, version 0.2.0): explicit Check update / Install update controls now use a fixed GitHub release manifest, immutable commit and SHA256. Curl transport retains TLS verification and bounds binary stdout independently of curl version. Complete archive validation precedes extraction; staged frozen dependencies, Codex readiness and runtime schemas precede service replacement. Data is moved unchanged and activation failure restores old code/dependencies/data. Installation is blocked during content tasks; HTTP writes and scheduling pause while updating. A detached worker survives the planned service restart by using a separate session/process group.

Updater verification: all 47 tests passed and npm run check passed. Actual Chromium exercised update discovery, installation control, reload to the new version and 360px layout against a local fixture. The real source ZIP extracted successfully, npm ci installed frozen dependencies through absolute Node/npm and staged Codex passed the integrated readiness probe. Production GitHub transport successfully read the repository. Independent review's three readiness/transport findings were corrected and followed up. Actual macOS launchd replacement remains untested in this Linux environment and needs acceptance after the one-time 0.2.0 install.
