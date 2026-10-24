# Diagrams to extract

A prose paragraph before the diagrams.

````archdia
---
type: PLANTUML
---
```plantuml
@startuml
component "Alpha Component" as Alpha
component "Beta Component" as Beta
Alpha --> Beta
@enduml
```
===
---
type: LAYOUT
---
```json
{
  "size": {
    "width": 640,
    "height": 480
  },
  "positions": {
    "Alpha": {
      "x": 40,
      "y": 40
    },
    "Beta": {
      "x": 300,
      "y": 40
    }
  }
}
```
````

A prose paragraph between the diagrams.

````archdia
---
id: base
type: PLANTUML
name: Base layer
---
```plantuml
@startuml
component "Gamma Component" as Gamma
@enduml
```
===
---
id: detail
type: PLANTUML
name: Detail layer
---
```plantuml
@startuml
component "Delta Component" as Delta
Gamma --> Delta
@enduml
```
===
---
type: LAYOUT
---
```json
{
  "size": {
    "width": 640,
    "height": 480
  },
  "positions": {
    "Gamma": {
      "x": 40,
      "y": 40
    },
    "Delta": {
      "x": 300,
      "y": 40
    }
  }
}
```
````

A prose paragraph after the diagrams.
