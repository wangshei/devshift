---
name: Dashboard UX trust signals
description: User finds confusing UI patterns erode trust in DevShift — wrong actions for task types, hard-to-read diffs
type: feedback
---

Show appropriate actions for each task type — research/analysis tasks should display results directly, not merge buttons. Diff viewer must be side-by-side with jump-to-diff navigation, not a raw unified dump.

**Why:** As the creator, the user feels reluctant to use DevShift because confusing UX (like showing "Approve & Merge" on analysis tasks) makes the system feel untrustworthy and poorly thought out.

**How to apply:** When building or modifying dashboard components, always consider the task type/tier and show contextually appropriate UI. Research tasks = show findings. Code changes = show diff + merge. Never show merge buttons for tasks that don't produce mergeable code.
