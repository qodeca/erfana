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
- 2026-09-25 10:18 CEST - direct question - #145 circuit-electron leak: "Yes, in 0.21.0, first (Recommended)". Labelled release-0.21.0; dispatched before the #140 and #141 design fixes.
- 2026-09-25 10:42 CEST - chat - "Ensure circuit-electron won't stop you from moving forward in the future, apply required changes to your processess and save them so future sessions won't end up in the same situation"
- 2026-09-25 10:42 CEST - direct question - leader stops orphaned MCP servers itself: "Yes, via a narrow script (Recommended)". #145 adds scripts/stop-orphan-mcp.mjs; after it merges, the leader adds one allow rule for exactly `node scripts/stop-orphan-mcp.mjs` to the project .claude/settings.json.
- 2026-09-25 10:42 CEST - direct question - standing leader rule on orphan checks: no option picked; note "use /xez-add-rule for that". The owner runs /xez-add-rule; the leader never runs it (leader guide, "The owner's controls").
- 2026-09-25 10:48 - direct question - stopgap until #145 merges: "Keep going, you kill them". No settings change; the leader reports new orphans at each L1 tick with the exact kill -9 line.
- 2026-09-25 11:01 CEST - direct question - #145 version pin refused by Claude Code permissions: "Split it out (Recommended)". Pin filed as #147; the owner commits it by hand. PR #146 ships without it.
- 2026-09-25 11:10 CEST - direct question (xez-unattended-on contract read back, with the orphan-load risk until #146 merges) - "Yes, turn it on"
  Unattended mode on since 2026-09-25T09:10:38Z. Hard stops: release go, deleting a record, opening a campaign. Parked: account or provider lane switch, scope trim, third repair round. Accepted costs: metered spend while away; stops are instructions, not a hook; orphaned MCP servers may block work until #146 merges.
- 2026-09-25 12:35 CEST - direct question (AskUserQuestion: which login the sandboxed Claude Code uses in the #138 screenshots; must never show an email) - "A subscription login". Leader picks westagilelabs (weekly 0%). Spike stop rule stays: if the email shows, the capture stops.
- 2026-09-25 13:10 CEST - direct question (AskUserQuestion: the #138 spike, PR #149, stopped because a subscription token needs a browser sign-in by a person) - "Yes, I make it (Recommended)". The owner runs `claude setup-token` as westagilelabs and stores the token in a chmod 600 file outside the repo; the leader then re-runs only the login part of the spike.
- 2026-09-25 15:28 CEST - direct question (AskUserQuestion: allow-rule task 4458b282 stopped, Claude Code refuses a task edit of .claude/settings.json) - "I add it by hand". The owner pastes the two rules into the task worktree; the task then adds the doc line, runs the checks and opens the PR.
- 2026-09-25 17:22 CEST - direct question (AskUserQuestion: allow rule refused by the kit check in .claude/settings.json; where should it go?) - "Leader-only file (Recommended)". Rules go in scripts/xezar-leader-settings.json; the owner undoes the manual .claude/settings.json edit in both places.
- 2026-09-26 08:40 CEST - direct question (xez-unattended-off, parked 1 of 4: third repair round on PR #155, same-PR fix of S-1/S-2) - "Keep it (Recommended)"
  Parked by the leader 2026-09-25 18:27; owner kept it. #155 already merged (0c8cc10a).
- 2026-09-26 08:40 CEST - direct question (xez-unattended-off, parked 2 of 4: fourth repair round on PR #155, S-2 fail-closed fix) - "Keep it (Recommended)"
  Parked by the leader 2026-09-25 18:56; owner kept it.
- 2026-09-26 08:40 CEST - direct question (xez-unattended-off, parked 3 of 4: third repair round on PR #154, Windows test fix before merge) - "Keep it (Recommended)"
  Parked by the leader 2026-09-25 19:56; owner kept it. #154 already merged (c1b1ad21).
- 2026-09-26 08:40 CEST - direct question (xez-unattended-off, parked 4 of 4: lane switch for #138 steps 7-8 to codex/gpt-6-sol) - "Keep it (Recommended)"
  Parked by the leader 2026-09-25 20:47; owner kept it. #158 already merged (8949413e).
- 2026-09-26 08:42 CEST - direct question (AskUserQuestion: #159 QA, 3 checks unrun) - "I check by hand (Recommended)"
  Owner checks dark mode, banner theme switch and reduced motion on github.com (branch feature/139-readme-redesign); the leader merges on the owner's word once checks are green.
- 2026-09-26 08:42 CEST - direct question (AskUserQuestion: #147 pin) - "I do it by hand (Recommended)"
  #147 stays the owner's; stays in 0.21.0.
- 2026-09-26 08:42 CEST - direct question (AskUserQuestion: 16 npm audit advisories) - "New issue in 0.21.0 (Recommended)"
  Leader files one triage issue with the release-0.21.0 label and dispatches it.
- 2026-09-26 08:49 CEST - direct question (xez-unattended-on contract read back, with pi/deepseek-flash task d71e7bf0 running on metered spend) - "Yes, turn it on"
  Unattended mode on since 2026-09-26T06:49:11Z. Hard stops: release go, deleting a record, opening a campaign. Parked: account or provider lane switch, scope trim, third repair round. Accepted costs: metered spend while away; stops are instructions, not a hook.
