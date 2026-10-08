# Creator automation progress

User authorization: assistant chooses implementation method and proceeds with scripts / existing code adaptation.

Execution: native inline; existing isolated cloud checkout, feature branch feat/creator-automation. No additional worktree.

Current phase: Task 1. Design and plan written from the existing requirements.

Preflight: Task 2 consumes Task 1 source IDs and normalized metrics; Task 3 consumes both providers and Store; Task 4 consumes Workflow and scheduleDue. Interfaces named consistently in the plan.

Deployment boundary: current cloud session cannot install on the user's Mac. Packaging and automated local tests are possible here; real browser acceptance requires the one-time Mac install.
