---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Agent resource flows

This **conceptual data-flow model** follows agent resources from authoring to execution.
Processes are rounded, data stores cylindrical and external participants rectangular.
Arrows name data transfers.
The [solution design](../../solution-design/agentic-resources.md) maps these roles to Git, APM,
services and auditable paths.

## Sources and publications

An **agent definition** combines identity, standing instructions, model intent and dependency
declarations. **Skill definitions** contain guidance and companion files; **tool packages**
contain executable integrations and their configuration. Each resource has its own source history.
**Compiled instructions** and installed dependency projections are derived representations.

```mermaid
flowchart TB
    Author[Resource author]
    Shared[(Shared versioned repositories)]
    Edit([Import and edit resources])
    Local[(Local working trees and revision history)]
    Resolve([Resolve dependencies and compile])
    DependencyCache[(Local dependency download cache)]
    Publish([Publish a resource version])

    Author -->|Definitions and dependency declarations| Edit
    Shared -->|Clone or pull: sources and history| Edit
    Edit -->|Agent, skill and tool sources| Local
    Local -->|Definitions and dependency declarations| Resolve
    Shared -->|Download: dependency revisions| Resolve
    DependencyCache -->|Reusable dependency sources| Resolve
    Resolve -->|Downloaded dependency sources| DependencyCache
    Resolve -->|Locks, captured sources and compiled projections| Local
    Local -->|Sources and resolved derivatives| Publish
    Publish -->|Commit and version label| Local
    Publish -->|Push: published revision and version label| Shared
```

A publication fixes the **source revision** and **dependency state**. A later source edit
changes the draft. Existing execution context retains its selected snapshot. A resource can
be authored and published locally. A draft conversation captures the working definition and
its resolved dependencies.

## Delivery and execution

A **prepared deployment** contains the files needed to use a publication: locked dependencies,
skill projections, tool runtimes and tool configuration. The **publication cache** stores
transferable packages; the **execution cache** stores installed files on the task machine.
Neither cache owns the source definitions.

```mermaid
flowchart TB
    Sources[(Published revisions and dependency sources)]
    Prepare([Prepare a fixed publication])
    Packages[(Publication package cache)]
    Context[(Task reference and conversation publication snapshot)]
    Install([Fetch and install the selected package])
    Installed[(Execution machine package cache)]
    Bind([Bind resources to a turn])
    Harness[Harness executing the task]
    Evidence[(Execution provenance and conversation history)]

    Sources -->|Revision, dependency locks and source files| Prepare
    Prepare -->|Resolved deployment package| Packages
    Context -->|Publication ID| Install
    Packages -->|Download on execution cache miss: package files| Install
    Install -->|Unpacked deployment and cache metadata| Installed
    Installed -->|Skill catalogue and tool configuration| Bind
    Context -->|Published instructions and execution intent| Bind
    Bind -->|Instructions, skill paths and effective tool configuration| Harness
    Installed -->|Skill files and tool runtimes read in place| Harness
    Bind -->|Publication identity and effective configuration| Evidence
    Harness -->|Turn observations and history| Evidence

    Bundle[Delivered store skill bundle]
    Sync([Install store guidance])
    StoreSkills[(Store agent directories)]
    Bundle -->|Skill definitions and companion files| Sync
    Sync -->|Copy or refresh: selected skills| StoreSkills
    StoreSkills -->|Locally discoverable guidance| Harness
```

**Binding** to a **harness** supplies instructions and file references; it can also render temporary
configuration in the harness's format. The task workspace remains the working directory.
**Store guidance** is a separate delivery flow: selected skills are copied into the store's
agent directories for local discovery. Published agent dependencies remain in the execution cache.

**Execution provenance** identifies the publication, dependency revisions and effective runtime
configuration. Deleting a local source clone can make that publication unavailable for a new
installation; retained references and execution evidence still identify what was selected.
