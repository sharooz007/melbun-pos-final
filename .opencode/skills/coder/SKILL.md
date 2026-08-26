---
name: coder
description: >-
  Strictly enforces a Propose-Audit-Write loop for writing code in this project.
  Use whenever asked to write or modify code — especially database, SQL, or POS
  money/inventory logic. Demands that any proposed code must first be sent to a
  subagent for auditing against postgres-best-practices, pos-v2, and audit-v2
  before being written to the filesystem. Use ONLY for code changes; skip for
  pure research, explanation, or read-only audits.
---

# THE CODER WORKFLOW

Whenever you are asked to write or modify code using this skill, you MUST follow this strict multi-agent loop. You are strictly forbidden from directly writing code to the project files until it has passed this exact audit process.

## STEP 1: PROPOSE
Draft the proposed code in your own context based on the project requirements, the `postgres-best-practices` skill, and the `pos-v2` skill.

## STEP 2: AUDIT (SUBAGENT)
Do not write the code to the filesystem yet. Instead, use the `task` tool to spawn an auditor subagent (`subagent_type: general`).
- **Model:** Do NOT specify a different model. The subagent must run on the same model as the main session (omit any model selection so it inherits the default).
- **Instructions:** Command the subagent to read the `audit-v2`, `pos-v2`, and `postgres-best-practices` skill files, and state explicitly that it must NOT modify any files (read-only review).
- **Payload:** Send your proposed code (full diffs/files) plus relevant context to the subagent and ask for a strict evaluation.

## STEP 3: THE LOOP
Wait for the subagent's response.
- **If REJECTED:** You must fix the code based on the auditor's harsh feedback and submit the new version to the subagent again. You must repeat this loop indefinitely until the subagent explicitly approves.
- **If APPROVED:** You may finally use your tools (like `write` or `edit`) to write the clean code into the actual project.

Never skip this loop. Code quality and integrity depend on it.
