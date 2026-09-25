# Decisions

Owner decisions in the owner's exact words, dated, append-only.

- 2026-09-25 00:03 CEST - chat (direct question: open a campaign now?) - "Yes, name it release-0.21.0"
- 2026-09-25 00:03 CEST - chat - "create gh label release-0.21.0 and I will start marking gh issues with this label so you know what to work on"
  Standing rule: campaign scope = open issues carrying the `release-0.21.0` label.
- 2026-09-25 00:04 CEST - chat - "the scope are gh issues labeled with release-0.21.0 and new tasks and issues I will be discussing with you and you will be adding to gh with the appropriate label"
  Standing rule (widens the earlier one): scope = open issues labelled `release-0.21.0`, plus new work the owner discusses with the leader; the leader files each as a GitHub issue carrying `release-0.21.0`.
- 2026-09-25 00:11 CEST - chat - "First task in this campaign. Erfana's branding and how it presents on GitHub is terrible. Additionally it doesn't contain a comprehensive user guide. I want you to improve how Erfana's README.md looks like so it follows the best looking GH README.md ideas. Additionally I want you to prepare erfana's user guide with screenshots and overall documentation of all of the functionality. I assume you will fill it as two separate gh issues and later you will analyse, design, plan, implement and test those tasks. Interview me using AskUserQuestion to ensure you have all required information"
- 2026-09-25 00:11 CEST - chat - "do a comprehensive online research if needed"
- 2026-09-25 00:11 CEST - direct question (interview) - owner's picks, verbatim option labels:
  - README audience: "New users first (Recommended)"
  - User guide home: "Markdown in the repo (Recommended)"
  - Screenshots: "Automated script (Recommended)"
  - Branding: "Design a new banner (Recommended)"
  - Demo: "Yes, a short animated demo (Recommended)"
  - Screenshot platforms: "macOS only (Recommended)"
  - Guide depth: "Tasks plus reference (Recommended)"
  - Qodeca, licence and signing sections: "Keep short, link out (Recommended)"
  - Sample data: "A made-up demo project (Recommended)"
  - Agent shown in demo: "Real Claude Code, scrubbed (Recommended)"
  - Design gate: "No need to review, decide yourself and trust reviewers"
  - Existing user docs: "Fold into the guide (Recommended)"
  Standing rule for these two issues: design is approved by a reviewer agent on a different model, not by the owner.
- 2026-09-25 00:14 CEST - chat - "start immediately, do not wait for the loop if there is work you can kick off"
  Standing rule: when ready work and headroom exist, the leader dispatches at once instead of waiting for the L3 tick. Every other L3 check (ceilings, overlap, route.mjs, budget) still applies.
- 2026-09-25 00:23 CEST - direct question (xez-unattended-on contract read back) - "Yes, turn it on"
  Unattended mode on since 2026-09-24T22:23:07Z. Hard stops: release go, deleting a record, opening a campaign. Parked: account or provider lane switch, scope trim, third repair round. Accepted costs: overnight metered spend; stops are instructions, not a hook.
- 2026-09-25 10:12 CEST - direct question - orphaned circuit-electron servers: "You may stop them (Recommended)". Scope: only orphans (ppid 1), by exact PID after checking each; keep any with a live parent.
- 2026-09-25 10:12 CEST - direct question - repo description, topics, social preview from PR #140: "After README merges (Recommended)". Leader shows the exact values before applying.
- 2026-09-25 10:12 CEST - direct question - extend TRADEMARKS.md to the new banner, wordmark and social image: "Yes, add them (Recommended)". Lands in the #139 build PR.
- 2026-09-25 10:12 CEST - direct question - code/doc mismatches from the #141 inventory: "File in 0.21.0 (Recommended)". Separate small issues with the release-0.21.0 label.
