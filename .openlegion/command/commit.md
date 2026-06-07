---
description: git commit and push
model: openlegion/kimi-k2.5
subtask: true
---

commit and push

Use conventional commit-style messages: `type(scope): summary`.

Valid types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`.
Scopes are optional; use the affected package or area when helpful, e.g. `core`, `openlegion`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples:
- `fix(tui): simplify thinking toggle styling`
- `docs: update contributing guide`
- `feat(desktop): list running containers`

Prefer to explain WHY something was done from an end user perspective instead of WHAT was done.

Do not use generic messages like "improved agent experience"; be specific about user-facing changes.

if there are conflicts DO NOT FIX THEM. notify me and I will fix them

## GIT DIFF

!`git diff`

## GIT DIFF --cached

!`git diff --cached`

## GIT STATUS --short

!`git status --short`
