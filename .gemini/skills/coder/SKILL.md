---
name: coder
description: >-
  Strictly enforces a Propose-Audit-Write loop for writing code. Demands that any proposed code must first be sent to a subagent (using the 'flash' model) for auditing against postgres-best-practices, pos-v2, and audit-v2 before being written to the filesystem.
---

# THE CODER WORKFLOW

Whenever you are asked to write or modify code using this skill, you MUST follow this strict multi-agent loop. You are strictly forbidden from directly writing code to the project files until it has passed this exact audit process.

## STEP 1: PROPOSE
Draft the proposed code in your own context based on the project requirements, `/postgres-best-practices`, and `/pos-v2`.

## STEP 2: AUDIT (SUBAGENT)
Do not write the code to the filesystem yet. Instead, use the `invoke_subagent` tool to spawn an auditor subagent.
- **Model:** You MUST set the subagent's Model argument to `flash`.
- **Instructions:** Command the subagent to read the `/audit-v2`, `/pos-v2`, and `/postgres-best-practices` skill files.
- **Payload:** Send your proposed code to the subagent and ask for a strict evaluation.

## STEP 3: THE LOOP
Wait for the subagent's response.
- **If REJECTED:** You must fix the code based on the auditor's harsh feedback and submit the new version to the subagent again. You must repeat this loop indefinitely until the subagent explicitly approves.
- **If APPROVED:** You may finally use your tools (like `write_to_file` or `replace_file_content`) to write the clean code into the actual project.

Never skip this loop. Code quality and integrity depend on it.
