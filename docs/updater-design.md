# Workbench updates

The user wants to avoid manually replacing downloaded installers for each program change. Existing authorization delegates implementation choices and publishing to the feature branch. Extend the existing Mac LaunchAgent installation; do not create a cloud-to-Mac bridge or silently install remotely published code.

The settings page shows a version and Check update / Install update buttons. Only a user click initiates installation. A fixed GitHub repository provides `releases/latest.json` with version, immutable archive commit and SHA256. Native curl supports the existing network/proxy environment while retaining TLS verification. No browser token, notes, cookies or other local data are sent to GitHub.

The worker downloads a bounded ZIP, verifies SHA256 and validates its full directory, paths, regular-file types, uncompressed size, CRCs and required runtime files before extraction. Stage frozen npm dependencies and verify the staged Codex command before stopping the current service. Obtain the content lock before switching. Move the existing data directory unchanged into the new program, restart through the existing LaunchAgent and verify the application status endpoint. Activation failure restores the old program, old dependencies and the same data directory. Update progress survives service restart in local data.

The detached worker has its own session/process group and a local log. Current and new servers pause scheduling/content work and reject writes while installation is active; duplicate clicks do not clear the active marker. The UI polls progress, treats the restart as expected and reloads on version change. macOS launchd survival and the complete live update still require Mac acceptance; Linux unit and browser tests cannot establish those platform results.

Publication is two commits: first the tested archive plus its checksum, then a metadata pointer referencing that archive commit. Future updates must increment the package version. The initial 0.2.0 requires one final manual install because an old binary cannot acquire its own updater from this separate cloud chat.
