import { describe, it, expect } from 'vitest';
import { computePlantUmlLayout } from './plantuml-layout';
import { plantumlExtractor } from './diagram-source';
import { computeContainerBounds } from './container-bounds';
import { DiagramScene } from './archdia-model';
import { estimateNodeWidth, getNodeHeight } from './component-sizing';

/** The scene a source declares, the way every caller of the layout builds it. */
const sceneOf = (source: string): DiagramScene => ({
    components: plantumlExtractor.extractComponents(source),
    containers: plantumlExtractor.extractContainers(source),
    relations: plantumlExtractor.extractRelations(source),
});

const layoutOf = (source: string, size?: { width: number; height: number }) =>
    computePlantUmlLayout(sceneOf(source), source, size);

/** The box an element is drawn in, at the size the renderer will give it. */
const boxOf = (scene: DiagramScene, positions: Record<string, { x: number; y: number }>, key: string) => {
    const component = scene.components.find(c => (c.alias || c.name) === key)!;
    const { x, y } = positions[key];
    return {
        x, y,
        width: estimateNodeWidth(component.name, component.members),
        height: getNodeHeight(component.type, component.members),
    };
};

describe('plantuml-layout', () => {

    it('ranks a relation from its source down to its target', async () => {
        const source = `@startuml
rectangle A
rectangle B
rectangle C
A --> B
B --> C
@enduml`;

        const { positions } = await layoutOf(source);

        expect(positions.A.y).toBeLessThan(positions.B.y);
        expect(positions.B.y).toBeLessThan(positions.C.y);
    });

    it('reads `left to right direction` as ranks running sideways', async () => {
        const source = `@startuml
left to right direction
rectangle A
rectangle B
A --> B
@enduml`;

        const { positions } = await layoutOf(source);

        expect(positions.A.x).toBeLessThan(positions.B.x);
        expect(Math.abs(positions.A.y - positions.B.y)).toBeLessThan(40);
    });

    it('keeps the first element written above the second, arrow pointing back', async () => {
        // PlantUML ranks by the order the two are written, not by the arrowhead:
        // `A <-- B` still draws A above B.
        const source = `@startuml
rectangle A
rectangle B
A <-- B
@enduml`;

        const { positions } = await layoutOf(source);

        expect(positions.A.y).toBeLessThan(positions.B.y);
    });

    it('sends the target of an `-up->` above its source', async () => {
        const source = `@startuml
rectangle A
rectangle B
A -up-> B
@enduml`;

        const { positions } = await layoutOf(source);

        expect(positions.B.y).toBeLessThan(positions.A.y);
    });

    it('holds a `-right->` pair on one rank, in the order asked for', async () => {
        const source = `@startuml
rectangle Root
rectangle A
rectangle B
Root --> A
A -right-> B
@enduml`;

        const { positions } = await layoutOf(source);

        expect(positions.A.y).toBe(positions.B.y);
        expect(positions.A.x).toBeLessThan(positions.B.x);
    });

    it('holds a C4 `Rel_Neighbor` pair on one rank, in declaration order', async () => {
        const source = `@startuml
!include <c4/C4_Container.puml>
Person(customer, "Customer")
Container(web, "Web App", "Java")
ContainerDb(db, "Database", "SQL")
Container(api, "API", "Java")
Rel(customer, web, "Uses")
Rel(web, api, "Uses")
Rel_Back_Neighbor(db, api, "Reads from")
@enduml`;

        const scene = sceneOf(source);
        const { positions } = await computePlantUmlLayout(scene, source);

        // A cylinder is taller than a box, and the rank runs through the middle
        // of both, so it is the centres that line up.
        const centre = (key: string) => {
            const box = boxOf(scene, positions, key);
            return box.y + box.height / 2;
        };
        expect(Math.abs(centre('db') - centre('api'))).toBeLessThanOrEqual(1);
        // `db` is declared first, and a rank reads in declaration order.
        expect(positions.db.x).toBeLessThan(positions.api.x);
    });

    it('leaves no package overlapping another', async () => {
        const source = `@startuml
package "Left" {
    rectangle A
    rectangle B
    rectangle C
}
package "Right" {
    rectangle D
    rectangle E
}
A --> B
B --> C
A --> D
D --> E
@enduml`;

        const scene = sceneOf(source);
        const { positions } = await computePlantUmlLayout(scene, source);
        const bounds = computeContainerBounds(scene.containers, scene.components, positions);

        const [left, right] = [bounds.Left, bounds.Right];
        const overlapX = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
        const overlapY = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
        expect(overlapX > 0 && overlapY > 0).toBe(false);
    });

    it('sizes the document so the whole diagram is inside it', async () => {
        const source = `@startuml
package "Wide" {
    rectangle "A very long element name indeed" as A
    rectangle "Another very long element name" as B
    rectangle "And a third long element name" as C
}
A --> B
A --> C
@enduml`;

        const scene = sceneOf(source);
        const { size, positions } = await computePlantUmlLayout(scene, source, { width: 200, height: 200 });
        const bounds = computeContainerBounds(scene.containers, scene.components, positions);

        for (const key of Object.keys(positions)) {
            const box = boxOf(scene, positions, key);
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.y).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(size.width);
            expect(box.y + box.height).toBeLessThanOrEqual(size.height);
        }
        // Packages reach past their children, and must fit too.
        for (const rect of Object.values(bounds)) {
            expect(rect.x).toBeGreaterThanOrEqual(0);
            expect(rect.y).toBeGreaterThanOrEqual(0);
            expect(rect.x + rect.width).toBeLessThanOrEqual(size.width);
            expect(rect.y + rect.height).toBeLessThanOrEqual(size.height);
        }
    });

    it('keeps the size asked for when the diagram fits, and centres it there', async () => {
        const source = `@startuml
rectangle A
rectangle B
A --> B
@enduml`;

        const { size, positions } = await layoutOf(source, { width: 1200, height: 900 });

        expect(size).toEqual({ width: 1200, height: 900 });
        // Centred: as much room on the left as on the right.
        const left = Math.min(...Object.values(positions).map(p => p.x));
        const right = Math.max(...Object.values(positions).map(p => p.x + estimateNodeWidth('A')));
        expect(Math.abs(left - (size.width - right))).toBeLessThanOrEqual(2);
    });

    it('positions leaf components only — package bounds are the renderer\'s to compute', async () => {
        const source = `@startuml
package "Box" {
    rectangle A
}
@enduml`;

        const { positions } = await layoutOf(source);

        expect(positions.A).toBeDefined();
        expect(positions.Box).toBeUndefined();
    });

    it('places every element of a scene, connected or not', async () => {
        const source = `@startuml
rectangle A
rectangle B
rectangle Lonely
A --> B
@enduml`;

        const { positions } = await layoutOf(source);

        expect(Object.keys(positions).sort()).toEqual(['A', 'B', 'Lonely']);
    });
});
