---
name: coder
description: >-
  Strictly enforces a Propose-Orthogonal-Audit-Write loop for writing code. Demands that any proposed code must first be drafted via the /boost delegation routine (using DeepCoder), then sent to three specialized, adversarial subagents (Schema Purist, Runtime Hacker, Math Validator) for rigorous proof-of-correctness before being written to the filesystem.
---

# THE CODER WORKFLOW (V3: BOOST-POWERED ADVERSARIAL AUDITING)

Whenever you are asked to write or modify code using this skill, you MUST follow this strict multi-agent loop. You are completely forbidden from writing code to the project files until it has passed this exact adversarial audit process.

## STEP 1: PROPOSE (via /boost Delegation)
Do not perform the initial research, planning, or drafting yourself (No Pre-work). You must execute the **Delegation Routine** by spawning a `DeepCoder` subagent to generate the initial code proposal.
- **Subagent:** `invoke_subagent` with `TypeName='DeepCoder'` and `Workspace='inherit'`.
- **Prompt:** You must use the strict `/boost` prompt template:
  `**Task**: [The user's original message, verbatim.]`
  `**Additional Context**: Instruct DeepCoder to draft the proposed changes in a PROPOSAL.md artifact (or hold in memory), but STRICTLY FORBID it from modifying the actual project files.`

## STEP 2: ORTHOGONAL ADVERSARIAL AUDIT
Once `DeepCoder` returns the proposal, you MUST use the `invoke_subagent` tool to spawn THREE parallel subagents with orthogonal, hostile roles to audit the proposal.
- **Model Override:** You MUST set the `Model` argument strictly to `flash` for all three of these auditing subagents to ensure maximum speed during the debate loop.

### Subagent 1: The Schema Purist
- **Mandate:** Static analysis and Schema verification. Banned from evaluating business logic.
- **Rule:** Do not trust memory. You MUST use `grep_search`, `find_by_name`, or terminal commands to read the historical `supabase/migrations/` files.
- **Goal:** Verify that every single table name, column name, relation, and ENUM string perfectly matches the exact definitions in the database. 

### Subagent 2: The Runtime Hacker
- **Mandate:** Type-safety and crash prevention.
- **Rule:** Look exclusively for JavaScript falsy/truthy bugs, missing TypeScript interface properties, unhandled Zod schemas, and PostgreSQL typecasting errors.
- **Goal:** Break the payload structure and execution bounds.

### Subagent 3: The State & Math Validator
- **Mandate:** Financial integrity and concurrency.
- **Rule:** Assume multiple users are hitting the system at the exact same millisecond.
- **Goal:** Catch race conditions, bypasses in idempotency keys, missing pessimistic locks (`FOR UPDATE`), and rounding errors in financial math.

## STEP 3: DIALECTICAL CONSENSUS LOOP
Wait for all three subagents to return their reports.
- **If ANY subagent REJECTS:** You must compile the feedback, send it back to the `DeepCoder` subagent to revise the code, and submit the new version to the triad for a re-audit. Repeat indefinitely.
- **If 100% UNANIMOUS APPROVAL:** You may finally use `write_to_file` or `replace_file_content` to commit the code to the actual project files.

Never skip this loop. Code quality and integrity depend on separating concerns and forcing agents to explicitly prove the schema via terminal search.
