# Legacy diagram block

An `archdia` block predating the `===`-separated block format. It renders empty,
and editing it must be refused rather than silently rewrite it as an empty diagram.

```archdia
@startuml
component "Legacy Component"
@enduml
---
{
  "size": { "width": 640, "height": 480 },
  "positions": {}
}
```
