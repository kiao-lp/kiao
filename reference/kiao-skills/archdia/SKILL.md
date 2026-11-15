---
name: archdia
description: This skill should be used when the user asks to "create an architecture diagram", "modify an .arch.md file", "add a component to the diagram", "create a trust boundary", "add diagram layers", "write archdia", "edit archdia", "generate a Services and functions page", "which container provides which service", or works with .arch.md files, archtools architecture format, PlantUML with free positioning, or archdia diagrams.
---

# ArchDia — Architecture Diagrams with Free Positioning

ArchDia is a diagram format that uses PlantUML as the source of truth for architecture structure, but separates layout (element positions) from structure. Files use the `.arch.md` extension.

## File Format

An `.arch.md` file consists of **blocks** separated by `\n===\n` (three equals signs on their own line). Each block has a YAML-like frontmatter header.

### Block Structure

```
---
type: PLANTUML
---
[PlantUML source]
===
---
type: DESCRIPTIONS
---
[Markdown descriptions]
===
---
type: LAYOUT
---
[JSON positions]
```

### Block Types

| Type | Required | Purpose |
|------|----------|---------|
| `PLANTUML` | Yes (at least one) | PlantUML source defining components, containers, and relations |
| `DESCRIPTIONS` | No | Markdown text with per-element descriptions |
| `LAYOUT` | No (auto-computed if absent) | JSON with element positions |

### Frontmatter Fields

Each block starts with `---`-delimited frontmatter:

- **type** (required): `PLANTUML`, `DESCRIPTIONS`, or `LAYOUT`
- **id** (optional, PLANTUML only): DOM id for the SVG layer
- **name** (optional, PLANTUML only): Human-readable layer name

### Code Fence Wrapping

Block bodies can optionally be wrapped in markdown code fences. The parser strips them automatically:
- PLANTUML blocks: `` ```plantuml ``
- DESCRIPTIONS blocks: `` ```markdown ``
- LAYOUT blocks: `` ```json ``

When serializing, code fences are always added.

### Block Separator

**Always use `===` as the block separator, never `---`.**

The separator is exactly `\n===\n` — a newline, three equals signs, and a newline.

## PLANTUML Block

### Supported Element Keywords

Components (leaf elements rendered as shapes):

| Keyword | Shape |
|---------|-------|
| `component` | Rounded rectangle |
| `rectangle` | Rounded rectangle |
| `node` | Rounded rectangle |
| `database` | Cylinder |
| `actor` | Stick figure |
| `queue` | Queue (rounded ends) |
| `class` | UML class box with compartments |
| `interface` | UML class box with compartments |
| `enum` | UML class box with compartments |
| `entity` | Entity shape (75px tall) |
| `card` | Card shape |
| `storage` | Storage shape (75px tall) |
| `cloud` | Cloud shape (75px tall) |
| `artifact` | Artifact shape (75px tall) |
| `boundary` | Boundary shape (75px tall) |
| `control` | Control shape (75px tall) |
| `hexagon` | Hexagon shape |
| `collections` | Collections shape (75px tall) |

Icon-style elements (marked "75px tall" above) render taller than the default 50px to accommodate their icon plus label.

### Element Declaration Syntax

```plantuml
' Quoted name with alias
component "Display Name" <<stereotype>> as Alias

' Quoted name without alias (name is used as key)
database "My Database"

' Unquoted name (single word, used as both name and key)
rectangle MyService

' With stereotype
rectangle "Catalog" <<service>> as MSCatalog
```

**Important**: The element key (used in positions and relations) is the **alias** if present, otherwise the **name**.

### Container Keywords

Containers group child elements with `{ ... }` syntax:

```plantuml
package "Container Label" <<stereotype>> as Alias {
    component "Child" as Child1
    component "Other" as Child2
}
```

Container keywords: `package`, `frame`, `folder`, `cloud`, `node`, `rectangle`

When a keyword like `rectangle`, `frame`, `folder`, `cloud`, or `node` is followed by `{ ... }`, it becomes a container. Without braces, it's a leaf component. Only `package` is exclusively a container keyword — the others also appear in the element keywords table and can be used either way.

Containers can be nested:

```plantuml
package "Outer" {
    package "Inner" {
        component "Deep" as Deep1
    }
}
```

### Class and Interface Members

`class` and `interface` elements can have body members:

```plantuml
class FileSet {
    id : String
    name : String
    +addFile(file : File) : void
    -removeFile(file : File) : void
    {static} createDefault() : FileSet
    {abstract} validate() : boolean
}
```

Visibility markers: `+` (public), `-` (private), `#` (protected), `~` (package).
Modifiers: `{static}`, `{abstract}`.
Methods are detected by the presence of `(` in the text.

### Relations (Edges)

```plantuml
' Basic arrows
A --> B : label
A <-- B : reverse direction
A ..> B : dashed arrow
A -- B : solid line (no arrow)

' Styled relations
A -[thickness=3]- B
A -[#orange]- B
A -[thickness=3,#orange]- B : styled

' UML relationship arrows
A *-- B : composition
A o-- B : aggregation
A <|-- B : inheritance (triangle arrow)
A ..|> B : dashed implementation

' With description reference
A --> B [[#IntegrationDetails]] : REST API
A --> B : REST API [[#IntegrationDetails]]
```

#### Relation Style Block `[...]`

Inside `[...]` between dashes:
- `#color` or `#hexcode` — stroke color
- `thickness=N` — stroke width
- `bold` — shorthand for thickness=3

#### Description References `[[#Key]]`

Relations can reference a section in the DESCRIPTIONS block using `[[#Key]]` syntax. This can appear either after the target element or inside the label text.

### C4 Diagrams

[C4-PlantUML](https://github.com/plantuml-stdlib/C4-PlantUML) macros are recognised alongside native
PlantUML syntax, in the same PLANTUML block. A C4 source can be pasted in unchanged.

```plantuml
@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Context.puml

Person(customer, "Customer", "Buys standards, manages subscriptions")

Enterprise_Boundary(elastic_path, "Elastic Path") {
    System(storefront, "Storefront", "Browsing, cart & checkout")
    System(composable_cloud, "Composable Cloud", "Orders, subscriptions, billing")
}

System_Ext(psp, "PSP", "Payment service provider")

Rel(customer, storefront, "Browses & orders", "HTTPS")
Rel(composable_cloud, psp, "Processes payments", "HTTPS")
@enduml
```

#### Elements

| Macro | Shape |
|-------|-------|
| `Person`, `Person_Ext` | Stick figure |
| `System`, `Container`, `Component` (+ `_Ext`) | Rounded rectangle |
| `SystemDb`, `ContainerDb`, `ComponentDb` (+ `_Ext`) | Cylinder |
| `SystemQueue`, `ContainerQueue`, `ComponentQueue` (+ `_Ext`) | Queue |

- **The alias is the element key** — `System(storefront, "Storefront")` is keyed `storefront`, so that
  is what LAYOUT positions and relations use.
- **Technology → stereotype**: `Container`/`Component`/`Node` take a technology as third argument
  (`Container(api, "API", "Spring Boot", "…")` renders «Spring Boot»). `Person`/`System` have no
  technology — their third argument is the description.
- **Description → tooltip**: the description argument is shown on hover. A DESCRIPTIONS entry for the
  same key overrides it, which is the way to write a longer, markdown-formatted description.
- **`_Ext` elements are drawn muted**, marking them as outside the system under design.

#### Boundaries

| Macro | Stereotype |
|-------|-----------|
| `Enterprise_Boundary(alias, "Label")` | «enterprise» |
| `System_Boundary(alias, "Label")` | «system» |
| `Container_Boundary(alias, "Label")` | «container» |
| `Boundary(alias, "Label", "Type")` | «Type» |
| `Node(alias, "Label", "Type", "Descr")` | «Type» |

Boundaries follow the same `{ ... }` rules as packages, and nest the same way. A boundary macro
written without braces renders as a plain box rather than a container.

#### Relations

```plantuml
Rel(storefront, keycloak, "Authenticates customers", "OIDC")
Rel_Back(worker, queue, "Consumes")     ' arrow points worker ← queue
BiRel(a, b, "Syncs both ways")          ' arrowheads on both ends
Rel(a, b, "Undecided", "REST", $tags="decision")
```

The technology argument renders under the label. Direction suffixes (`Rel_Up`, `Rel_D`,
`Rel_Neighbor`, …) do not move anything by themselves — positions come from the LAYOUT block — but
the PlantUML layout reads them when it recomputes one.

`AddRelTag("name", $lineColor=…, $lineStyle=DashedLine(), $lineThickness=N)` styles every relation
tagged with `$tags="name"`.

#### Ignored and Unsupported

Ignored (harmless, kept in the source): `!include`, `SHOW_LEGEND()`, `Lay_*` layout hints,
`UpdateElementStyle`, `title`. `LAYOUT_LEFT_RIGHT()` / `LAYOUT_TOP_DOWN()` are kept too, and read
by the PlantUML layout.

Not supported: `AddElementTag` colours (elements have no per-element colour), sprites, legends.

### Skinparam and Directives

Standard PlantUML directives are preserved in the source:

```plantuml
@startuml
skinparam componentStyle rectangle
skinparam defaultTextAlignment center
left to right direction
' ... elements and relations ...
@enduml
```

The `@startuml`/`@enduml` wrappers are optional but conventional.

## Multiple Diagram Layers

A file can contain **multiple PLANTUML blocks**, each with its own `id` and `name`. This enables layered views of the same architecture:

```
---
id: structure
type: PLANTUML
name: System Structure
---
@startuml
package "Backend" {
    component "API" as API
    component "Worker" as Worker
    database "DB" as DB
}
@enduml
===
---
id: dataflow
type: PLANTUML
name: Data Flow
---
@startuml
API --> DB : queries
API --> Worker : async jobs
Worker --> DB : writes
@enduml
```

### Key Rules for Multiple Layers

1. **Components are shared by alias**: If two blocks reference the same alias (e.g., `API`), they are the same component. This is how you define structure in one layer and flows in another.
2. **Containers are deduplicated**: When multiple blocks declare the same container (by id), only the first declaration is kept.
3. **All sources are concatenated** for extraction: The parser joins all PLANTUML blocks to extract the complete scene.
4. **Each block becomes an SVG layer**: The wrapping HTML/app can toggle layers on/off using the `id`.

### When to Use Multiple Layers

- **Structure + Flow**: One block defines components and containers, another defines relations/flows
- **Different Concerns**: Security boundaries in one layer, data flows in another
- **Incremental Detail**: High-level overview in one layer, detailed interactions in another

## DESCRIPTIONS Block

The DESCRIPTIONS block uses markdown headings to assign rich text descriptions to diagram elements.

```markdown
## GW

Gateway component handles all incoming traffic.
Supports REST and WebSocket protocols.

## MSCatalog

Catalog service provides catalog access.

### Implementation Notes

Uses PostgreSQL for persistence.

## SecurityBoundary

Marks the trust perimeter for external access.
```

### Heading Rules

- Any heading level (`#` through `######`) can define a section
- The heading text must match an element's alias or name
- Content extends until the next heading of **same or higher level** (fewer `#` symbols)
- **Nested headings** (deeper level) are included in the parent's description
- Empty sections (heading with no body) produce no description

### Adding New Descriptions

When adding a description for an element that doesn't have one, append a new `## ElementKey` section at the end of the descriptions block.

### Patching Descriptions

To update an existing description, replace the content between the element's heading and the next same-or-higher-level heading.

## LAYOUT Block

The LAYOUT block is a JSON object with element positions, and optionally the bends given to
relations:

```json
{
  "size": {
    "width": 1024,
    "height": 768
  },
  "positions": {
    "API": { "x": 100, "y": 200 },
    "Worker": { "x": 300, "y": 200 },
    "DB": { "x": 200, "y": 400 }
  },
  "bends": {
    "API->DB": [0, -60]
  }
}
```

### Critical Layout Rules

1. **Only leaf components have position entries** — containers (packages, frames, etc.) do NOT have stored positions. Container bounds are computed at render time from their children's positions.
2. **Keys are aliases or names** — use the alias if the element has one (e.g., `"MSCatalog"` not `"Catalog"`), otherwise use the name.
3. **If LAYOUT is omitted**, the engine auto-computes positions using ELK's Sugiyama algorithm.
   A diagram imported from PlantUML instead arrives under the **PlantUML layout**, which places
   elements where PlantUML would have drawn them and sizes the document to hold all of them. It is
   also a toolbar button, so it is the way back to that arrangement at any point.
4. **Multiple LAYOUT blocks merge** — later blocks override earlier positions for the same keys.
5. **Stale positions are pruned** — positions for elements no longer in the PlantUML source are removed.
6. **New elements get incremental layout** — when adding components to an existing diagram, only the new elements are auto-placed; existing positions are preserved.

### Relation Bends

Every relation is drawn as a curve through one point — its centre. `bends` says where that centre
has been moved to, as an `[dx, dy]` offset from where the relation would put it itself: the middle
of the straight line between its two elements. A relation with no entry is drawn straight.

- **Keys are `from->to`** — the two element keys, exactly as the relation is written in the source.
  The label is not part of the key, so relabelling a relation keeps the shape it was given.
  Several relations written the same way round between the same pair are told apart by their order
  in the source: `API->DB`, then `API->DB#2`, `API->DB#3`.
- **An offset, not a place** — moving the elements carries the bend along, so the curve keeps its
  shape wherever the diagram is rearranged. Re-laying out a diagram, by any of the three layouts,
  keeps the bends: no layout engine has an opinion on where a relation's centre should be.
- **A relation to itself** is drawn as a loop, and its bend moves the middle of that loop while its
  two ends stay pinned to the element.
- **Stale bends are pruned** — a bend whose relation is no longer in the source is dropped.
- **Omit it** when writing a diagram by hand. Bends are something a reader gives a diagram at the
  handle on each relation's centre; a double-click there straightens it again.

### When Creating New Files

You can omit the LAYOUT block entirely. The rendering engine will auto-compute an initial layout. If you do include positions, make sure every leaf component has an entry.

## Special Stereotypes

### Trust Boundaries — `<<trust>>`

```plantuml
package "DMZ" <<trust>> {
    component "Public API" as PubAPI
    component "WAF" as WAF
}
```

Trust boundaries render with:
- **Red dashed border** (stroke: #ef4444, stroke-dasharray: 10 5)
- **Red label text**
- **Reduced margins** (8px all around instead of 32px top / 16px sides)
- **Transparent fill**

Use trust boundaries to visually mark security perimeters, network zones, or authentication boundaries.

### URM Stereotypes — Zone / District / Block

These follow an urban-planning metaphor for architectural decomposition:

```plantuml
rectangle "Operational Zone" <<zone>> {
    rectangle "Discovery Experience" <<district>> {
        rectangle "Fuzzy Search" <<block>>
    }
}
```

| Stereotype | Level | Rendering |
|------------|-------|-----------|
| `<<zone>>` | Highest | Low opacity (0.15), solid border |
| `<<district>>` | Mid | Medium opacity (0.4), solid border |
| `<<block>>` | Lowest (leaf) | Full opacity, solid border, rendered as component |

### Deployable Perimeters — `<<deployable>>`

Nesting can only say one thing, and a functional decomposition has already spent it. A
`<<deployable>>` says the other thing — what ships as one unit — by drawing a perimeter over the
same leaves rather than nesting them again:

```plantuml
' The structure: what the system does
rectangle "Authoring" <<district>> {
    rectangle "Document management" <<block>> as DocMgmt
    rectangle "Content generation" <<block>> as Generation
}
rectangle "Agent execution" <<district>> {
    rectangle "Agents workflow engine" <<block>> as Workflow
}

' The packaging: what leaves together, over the same blocks
rectangle "dashboard" <<deployable>> {
    rectangle "Document management" <<block>> as DocMgmt
    rectangle "Content generation" <<block>> as Generation
}
rectangle "worker" <<deployable>> {
    rectangle "Document management" <<block>> as DocMgmt
    rectangle "Agents workflow engine" <<block>> as Workflow
}
```

Redeclaring an alias does not duplicate it: the block gains a second parent, so there is one
component, one entry in LAYOUT and one box on screen, ringed by both its district and every
deployable that carries it. A role shipped by two units is enclosed twice, and the overlap is the
point — it marks where the deployment cut crosses a function.

Deployable perimeters render with:
- **No fill**, so whatever they cover stays readable
- **Solid border in the accent colour**, told apart from a trust boundary's red
- **Wider margins than a container** (56 top, 30 sides), so the perimeter is drawn *outside* the
  grouping it cuts across and its label clears the one underneath
- **Their label drawn** — unlike `<<trust>>`, which draws none

Perimeters nest, which is how two granularities of packaging are shown at once: an image
`<<deployable>>` around the two process `<<deployable>>`s it ships together.

Put the structure in one PLANTUML block and the packaging in another. Both are drawn together, and
the file then reads as two statements rather than one crowded map.

### ArchiMate Leaves — `<<app-service>>` and `<<app-function>>`

Inside a `<<deployable>>`, the two kinds of behaviour ArchiMate separates:

| Stereotype | What it is |
|------------|-----------|
| `<<app-service>>` | behaviour the unit exposes — something outside it can ask for it |
| `<<app-function>>` | behaviour the unit performs for itself, that nothing outside can ask for |

Both are structural, so the word is read from the source and never drawn on the box, and both are
drawn like a `<<block>>`: what tells a service from a function is the diagram it is in, one per
question. The bare `<<service>>` is deliberately *not* one of them — it is already in use across
these documents as a descriptive stereotype meaning a KIAO-built service, and it prints.

### Other Common Stereotypes

Stereotypes are free-form text and display below the element name:

```plantuml
component "Gateway" <<service>> as GW
rectangle "Keycloak" <<managed>> as KC
component "Mobile App" <<android/web>> as App
```

## The Services and Functions Page

A document a store keeps to say, at a glance, which container provides which **service** and which
container performs which **function**. Two questions, one diagram each. Both answers are generated
from the store's container list and a read of the code — not from what a previous version of the
page happened to say.

### Service or function

|  | Service — diagram 1 | Function — diagram 2 |
|---|---|---|
| What it is | what a user gets, end to end: a business reality, not an applicative one | what a container does inside itself, for its own working |
| Named with | a **verb** — *Manage a document base*, *Publish podcasts* | a **noun phrase** — *Git versioning*, *Speech synthesis* |
| Leaf | `<<app-service>>` | `<<app-function>>` |
| Shared between containers | yes, and the diagram is largely about that | no — one function, one container |
| A container that is a means, not an end of its own | renders none: nobody's goal is to be authenticated | has them, and the rest of the system rests on them |

A function is not a service seen closer. The same container appears in both diagrams saying
different things, and a container that renders no service still has functions.

**Altitude**: a global view, not a catalogue. Four items per container at most — merge the detail,
drop the anecdotal, and name each so a reader who has not read the code understands it. Forty routes
become three functions; a plugin list becomes one service.

### The page

`````markdown
# Services and functions

<!-- GENERATION RULES: the semantics above, in a dozen lines. -->

This document answers two questions:

1. Which container provides which (external) service?
2. Which container performs which (internal) function?

## 1. Container services

Which container provides which service? This diagram shows the external services the system
renders, within its deployable units (C4 containers).

<!-- What diagram 1 needs: superposition, and the layout rules it was given. -->

````archdia
---
id: services
type: PLANTUML
name: Services
---
```plantuml
…
```
===
---
type: LAYOUT
---
```json
…
```
````

## 2. Container functions

Which container performs which function? This diagram shows the internal functions of the system,
within its deployable units (C4 containers).

<!-- What diagram 2 needs. -->

````archdia
…
````
`````

The rules live in HTML comments placed where they apply, so the page regenerates in its own style
without carrying visible prose no reader asked for. Keep them short — they are read at every
regeneration.

A diagram inside a markdown page is an `archdia` fence holding what an `.arch.md` file would hold:
the blocks, `===` between them, each body in its own fence. **The outer fence therefore needs four
backticks**, or the inner ` ```plantuml ` closes it. The two diagrams are separate archdia blocks
that share nothing, so an alias need only be unique within one.

### Superposition — a service two containers render together

Every container is a `<<deployable>>` and every leaf sits inside one. A service that no single
container renders is declared inside *each* container that takes part in it — same label, same
alias, twice:

```plantuml
rectangle "dashboard" <<deployable>> {
    rectangle "Manage a document base" <<app-service>> as ManageDocuments
}
rectangle "worker" <<deployable>> {
    rectangle "Manage a document base" <<app-service>> as ManageDocuments
}
```

As **Deployable Perimeters** says above, that is one box with two parents, and the two perimeters
cross over it. The crossing is the statement: these units cannot be separated without losing the
service.

### Placing it by hand

Write the LAYOUT yourself — no layout engine knows about perimeters that cross. Only leaves get an
entry; a box is computed from its children. The arithmetic:

- a leaf is **50 tall** and roughly `max(100, 8 × label length + 40)` wide — a proportional-font
  estimate, good to about 20px either way, so leave slack rather than butting boxes together
- a `<<deployable>>` box is the bounding box of its leaves grown **56 top, 30 sides, 30 bottom**

**Diagram 1** — put the container that takes part in everything in the middle and its partners
around it, arranged so each partner crosses **exactly one edge** of it and none crosses a corner:
two boxes meeting at a corner read as a single shape.

**Diagram 2** — nothing is shared, so the boxes stand apart in a grid: columns 300 apart, leaves at
column + 30 and 70 below one another, the first 56 below its box top.

### Before calling it done

Compute every box from the positions and check four things: every leaf has a position; no box closes
over a leaf that is not its own; boxes sharing no leaf do not overlap; everything fits the declared
`size`. A box swallows whatever falls inside its rectangle, whatever the source says.

Then look at the render. Bounding boxes cannot make an L — a layout that would need one is a layout
to redo.

## Complete Example

Here is a realistic `.arch.md` file demonstrating multiple layers, trust boundaries, and descriptions:

```
---
id: structure
type: PLANTUML
name: System Structure
---
@startuml
skinparam componentStyle rectangle

actor Client

package "DMZ" <<trust>> {
    component "API Gateway" <<managed>> as GW
    component "WAF" as WAF
}

package "Backend Services" {
    component "Auth Service" <<service>> as Auth
    component "Catalog API" <<service>> as Catalog
    queue "Message Bus" as MQ
}

package "Data Layer" {
    database "User DB" as UserDB
    database "Catalog DB" as CatalogDB
}

Client --> WAF
WAF --> GW
@enduml
===
---
id: flows
type: PLANTUML
name: Service Flows
---
@startuml
GW --> Auth : authenticate [[#AuthFlow]]
GW --> Catalog : REST
Auth --> UserDB : queries
Catalog --> CatalogDB : queries
Catalog -[thickness=3]- MQ : events
@enduml
===
---
type: DESCRIPTIONS
---
## GW

API Gateway handles routing, rate limiting, and TLS termination.

## Auth

Authentication service supporting OAuth2 and SAML.

### Token Management

Issues and validates JWT tokens with configurable expiry.

## AuthFlow

Authentication uses a two-step flow:
1. Client sends credentials to Gateway
2. Gateway forwards to Auth Service for validation
===
---
type: LAYOUT
---
{
  "size": { "width": 1024, "height": 768 },
  "positions": {
    "Client": { "x": 100, "y": 50 },
    "WAF": { "x": 80, "y": 180 },
    "GW": { "x": 250, "y": 180 },
    "Auth": { "x": 100, "y": 350 },
    "Catalog": { "x": 300, "y": 350 },
    "MQ": { "x": 500, "y": 350 },
    "UserDB": { "x": 100, "y": 520 },
    "CatalogDB": { "x": 300, "y": 520 }
  }
}
```

## Editing Guidelines

### Creating a New `.arch.md` File

1. Start with a single PLANTUML block defining your architecture
2. Use `@startuml` / `@enduml` wrappers
3. Give components short aliases with `as` for cleaner position keys
4. Keep names short — use the DESCRIPTIONS block to store additional context, explanations, and details rather than encoding them in element names
5. Group related components in packages/containers
6. Add a DESCRIPTIONS block for components that need explanation
6. Omit the LAYOUT block — let the engine auto-compute initial positions

### Modifying an Existing `.arch.md` File

1. **Adding a component**: Add it to the appropriate PLANTUML block inside the right container. Do NOT add a position entry — the engine will auto-place it incrementally.
2. **Adding a relation**: Add it to the relevant PLANTUML block (or create a new layer block for a different concern).
3. **Adding a description**: Append a `## AliasOrName` section to the DESCRIPTIONS block.
4. **Moving to a different container**: Change the component's location in the PlantUML source. Its position will be preserved if the alias stays the same.
5. **Removing a component**: Remove from PlantUML source. Its position entry will be automatically pruned.

### Common Mistakes to Avoid

- **Using `---` instead of `===` as block separator** — `---` was the old format; always use `===`
- **Storing container positions in LAYOUT** — only leaf components get position entries
- **Using display name instead of alias as position key** — if `component "Catalog" as MSCatalog`, the key is `MSCatalog`
- **Forgetting frontmatter on blocks** — every block needs `---\ntype: TYPE\n---`
- **Adding LAYOUT entries for new components in existing diagrams** — let the incremental layout handle placement
- **Giving a package and a component the same ID** — a package (container) and a component (leaf) must never share the same alias or name (i.e., the key used in positions and relations), even if their display labels are identical
