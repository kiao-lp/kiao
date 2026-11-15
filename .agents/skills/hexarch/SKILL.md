---
name: hexarch
description: This skill should be used when the user asks to "create a hexagonal architecture", "scaffold a hex project", "add an adapter", "add a port", "add an entity", "add a service", "check hexagonal rules", "write hexarch", "edit hexarch", or works with hexagonal architecture structure, ports and adapters pattern, or domain-driven project layout.
---

# HexArch — Hexagonal Architecture

HexArch defines a project structure following the hexagonal (ports & adapters) architecture pattern. It enforces clean dependency rules between layers.

## Structure

### Core (domain, no framework dependencies)

The core contains all business logic and domain models. It has **zero dependencies** on adapters or external frameworks.

- `/core/entities/` — Domain models. Pure data structures and value objects that represent the business domain.
- `/core/ports/` — Contracts (interfaces/traits/protocols). Define how the core communicates with the outside world. Ports are the API of the core.
- `/core/services/` — Business logic. Orchestrate entities and depend only on ports, never on concrete adapter implementations.

### Adapters

Adapters implement and/or receive ports via dependency injection. They link the core to external systems (databases, APIs, CLI, web frameworks, message queues, etc.).

- `/adapters/` — One package per adapter. Each adapter package contains its main file plus any exclusive dependencies.

Example adapter packages:
- `/adapters/postgres/` — implements a repository port using PostgreSQL
- `/adapters/http-api/` — receives service ports, exposes them as HTTP endpoints
- `/adapters/cli/` — receives service ports, exposes them as CLI commands

### Libraries

- `/lib/` — Shared libraries used by **at least 2** components (core or adapters). Utility code that doesn't belong to the domain.

## Dependency Rules

These rules are **strict and must never be violated**:

| Source | Can depend on | Cannot depend on |
|--------|--------------|-----------------|
| `lib/` | (nothing internal) | `core/`, `adapters/` |
| `core/` | `lib/` | `adapters/` |
| `adapters/` | `core/`, `lib/` | other adapters (unless explicitly justified) |

In short:
- **lib does not depend on adapters or core**
- **core does not depend on adapters**
- Adapters depend on core (ports) and optionally lib

## Creating Components

### Adding an Entity

Create a file in `/core/entities/`. The entity must be a pure domain model with no external dependencies beyond `lib/`.

### Adding a Port

Create a file in `/core/ports/`. A port is an interface/contract. Name it after the capability it represents (e.g., `UserRepository`, `NotificationSender`, `EventPublisher`).

### Adding a Service

Create a file in `/core/services/`. Services receive ports via constructor injection and contain business logic. They must never import from `/adapters/`.

### Adding an Adapter

1. Create a new package directory under `/adapters/<adapter-name>/`.
2. The adapter implements one or more ports from `/core/ports/`.
3. Keep adapter-specific dependencies (drivers, SDKs) inside the adapter package.
4. The adapter receives any needed ports (for other external capabilities) via dependency injection.

### Adding a Library

Create a package under `/lib/`. A library must be used by at least 2 components. If it's only used by one component, it belongs inside that component instead.

## Validation Checklist

When creating or modifying files, verify:

1. No import from `/adapters/` exists in any `/core/` file
2. No import from `/adapters/` or `/core/` exists in any `/lib/` file
3. Each adapter package is self-contained (no cross-adapter imports unless explicitly justified)
4. Services depend on ports (interfaces), not concrete adapter implementations
5. New libraries in `/lib/` are used by at least 2 components
