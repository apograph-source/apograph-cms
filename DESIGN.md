# Design

Product & design intent — the *why* behind the UI and the experience, as
opposed to the *how* of [`ARCHITECTURE.md`](ARCHITECTURE.md).

> **Status: skeleton.** This document is owned by Design/Product. The sections
> below are the agreed structure; the `TODO:` prompts must be filled by a human
> who owns product direction. Agents: do **not** invent product intent here —
> leave the `TODO:` markers until a human supplies the content.

## Product vision

<!-- TODO: One paragraph — what is Ortha for, and who is it for? -->

## Target users & jobs-to-be-done

<!-- TODO: Primary personas (e.g. admins, content editors) and the core jobs
     each comes to the product to do. -->

## Design principles

<!-- TODO: 3–6 principles that resolve trade-offs (e.g. "governance over speed",
     "keyboard-first", "accessible by default"). Accessibility is already a hard
     requirement — see the `accessibility` skill (WCAG 2.1 AA). -->

## Information architecture

<!-- TODO: Top-level navigation and how features are grouped. The current shell
     is a left sidebar: a primary nav grouped Overview / Directory via
     SIDEBAR_NAV_SLOT (Home, Activity, Workspaces, Members), a Workspaces
     quick-list, and a persistent account footer. Inside a workspace the sidebar
     swaps to the workspace nav (switcher + Content + Workspace sections). -->

## Visual language

The component layer is the `@orthacms/design-system` (shadcn/ui + Tailwind),
governed by the `shadcn` skill.

<!-- TODO: brand tokens, color, typography, spacing, tone of voice, motion. -->

## Key flows

<!-- TODO: Describe the critical flows and their intended feel. Existing flows
     to document: login, invite member, create workspace, manage user (roles /
     access / sessions / activity). -->

## Open questions

<!-- TODO: Unresolved design decisions worth tracking. Significant resolved ones
     should graduate into an ADR under docs/adr/. -->
