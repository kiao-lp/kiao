# Architecture principles

These principles describe responsibilities and relationships independently of a particular
implementation. Concrete technology choices, file formats and deployment arrangements belong
in [solution designs](../solution-design/README.md).

## Functional boundaries

A functional set describes an end-to-end capability. A deployable unit describes an execution
boundary. One capability may require several deployable units, and one unit may participate in
several capabilities. Assign responsibilities by capability before choosing how to deploy them.

## Responsibility zones

- **Exchange** handles interaction with people and external systems.
- **Operation** owns shared business logic and coordinates work.
- **Reference** centralizes shared definitions and reusable knowledge.

These zones classify responsibilities; they do not prescribe a language, process count or
deployment topology.

## Dependencies and contracts

Business rules depend on explicit contracts rather than on infrastructure implementations.
Adapters connect those contracts to the outside world. Shared contracts have one authoritative
definition, with consumers referring to it instead of maintaining independent copies.

An optional extension must have a defined absence behavior. Consumers of an optional capability
must remain usable when its provider is unavailable.

## State and trust

Distinguish authored content, operational state and presentation state. Give each a clear owner
and lifetime so moving content, restarting execution or changing a view does not silently change
the meaning of another kind of state.

Distinguish the system's owner from a reader granted limited access. Reader boundaries remain
explicit even when the owner operates the whole installation.
