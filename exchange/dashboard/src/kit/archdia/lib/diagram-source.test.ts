import { describe, it, expect } from 'vitest';
import { extractPlantUmlDirection, plantumlExtractor } from './diagram-source';

const EXAMPLE_1 = `@startuml
skinparam componentStyle rectangle
skinparam defaultTextAlignment center
left to right direction

actor User

package "🌐 Operation" {
    node "Gateway\\n(Nginx)" as GW
    
    rectangle "Keycloak" <<managed>> as MSKeycloak
    rectangle "Catalog" <<service>> as MSCatalog

    queue "MOM\\n(Kafka)" as MOM

    MSKeycloak --> MOM
    MSCatalog <-- MOM
}

package "🌐 Exchange" {
    component "Unit builder" <<service>> as Publication
    component "Go" <<android/web>> as KiaoGO
    component "Notes" <<service/web>> as KiaoNotes

    KiaoNotes --> Publication : REST
    Publication --> GW : REST
    KiaoGO --> GW : REST
    KiaoNotes --> GW : REST
}

User --> KiaoNotes
User --> KiaoGO

package "🌐 Reference" {
    rectangle "Messages"

    MSKeycloak --> Messages
    MSCatalog --> Messages
}

package "🌐 Data Repository" {
    database "Keycloak DB"
    database "Unit DB"

    MSKeycloak --> "Keycloak DB"
    MSCatalog --> "Unit DB"
}

GW --> MSKeycloak
GW --> MSCatalog
@enduml`;

const EXAMPLE_2 = `@startuml binary-file-service

skinparam classAttributeIconSize 0

package "dto" {
  class GenTTSRequest {
    text : String
    voice : String
    speed : Double
    fileSetId : String
  }

  class GetTTSRequest {
    text : String
    voice : String
    speed : Double
  }
}

package "model" {
  class File {
    id : String
    contentType : String
    size : Long
    storagePath : String
    createdAt : LocalDateTime
  }

  class FileSet {
    id : String
    name : String
    addFile(file : File) : void
    removeFile(file : File) : void
  }

  class TTSConfig {
    id : String
    text : String
    voice : String
    speed : Double
  }
}

FileSet "*" -- "*" File : files
TTSConfig "1" -- "1" File : file

package "repository" {
  interface FileRepository << JpaRepository >> {
  }

  interface FileSetRepository << JpaRepository >> {
    deleteByName(name : String) : void
    findByName(name : String) : Optional<FileSet>
  }

  interface TTSConfigRepository << JpaRepository >> {
    findByTextAndVoiceAndSpeed(text : String, voice : String, speed : Double) : Optional<TTSConfig>
  }
}

package "service" {
  class FileStorageService {
    rootLocation : Path
    init() : void
    store(file : MultipartFile) : String
    store(data : byte[]) : String
    loadAsResource(filename : String) : Resource
    delete(filename : String) : void
  }

  class BinaryFileService {
    createFile(multipartFile : MultipartFile, fileSetId : String) : File
    getFile(id : String) : File
    deleteFile(id : String) : void
  }

  class TTSService {
    generate(request : GenTTSRequest) : File
    retrieve(request : GetTTSRequest) : File
  }
}

package "controller" {
  class FileController {
    uploadFile(file : MultipartFile, fileSetId : String) : ResponseEntity<File>
    getFile(id : String) : ResponseEntity<Resource>
    deleteFile(id : String) : ResponseEntity<Void>
  }

  class FileSetController {
    createFileSet(name : String) : ResponseEntity<FileSet>
    deleteFileSet(id : String) : ResponseEntity<Void>
  }

  class TTSController {
    generate(request : GenTTSRequest) : ResponseEntity<File>
    retrieve(request : GetTTSRequest) : ResponseEntity<File>
  }
}

class BinaryFileServiceApplication {
  {static} main(args : String[]) : void
}

class TextToSpeechClient << external >>

enum Status {
  ACTIVE
  INACTIVE
}

@enduml`;

describe('plantumlExtractor', () => {

  describe('extractComponents', () => {

    describe('example 1 (architecture diagram)', () => {
      const components = plantumlExtractor.extractComponents(EXAMPLE_1);
      const names = components.map(c => c.name);
      const aliases = components.map(c => c.alias).filter(Boolean);

      it('extracts actor declarations', () => {
        expect(names).toContain('User');
        const user = components.find(c => c.name === 'User');
        expect(user?.type).toBe('actor');
      });

      it('extracts node declarations with aliases', () => {
        const gw = components.find(c => c.alias === 'GW');
        expect(gw).toBeDefined();
        expect(gw!.name).toBe('Gateway\\n(Nginx)');
        expect(gw?.type).toBe('node');
      });

      it('extracts rectangle declarations with stereotypes and aliases', () => {
        expect(aliases).toContain('MSKeycloak');
        expect(aliases).toContain('MSCatalog');
        const msKeycloak = components.find(c => c.alias === 'MSKeycloak');
        const msCatalog = components.find(c => c.alias === 'MSCatalog');
        expect(msKeycloak?.stereotype).toBe('managed');
        expect(msCatalog?.stereotype).toBe('service');
        expect(msKeycloak?.type).toBe('rectangle');
        expect(msCatalog?.type).toBe('rectangle');
      });

      it('extracts component declarations', () => {
        expect(aliases).toContain('Publication');
        expect(aliases).toContain('KiaoGO');
        expect(aliases).toContain('KiaoNotes');
        const pub = components.find(c => c.alias === 'Publication');
        const kiaoGo = components.find(c => c.alias === 'KiaoGO');
        expect(pub?.stereotype).toBe('service');
        expect(kiaoGo?.stereotype).toBe('android/web');
        expect(pub?.type).toBe('component');
      });

      it('extracts queue declarations', () => {
        expect(aliases).toContain('MOM');
        const mom = components.find(c => c.alias === 'MOM');
        expect(mom?.type).toBe('queue');
      });

      it('extracts database declarations', () => {
        expect(names).toContain('Keycloak DB');
        expect(names).toContain('Unit DB');
        const db = components.find(c => c.name === 'Keycloak DB');
        expect(db?.type).toBe('database');
      });

      it('extracts rectangle without alias', () => {
        expect(names).toContain('Messages');
        const msgs = components.find(c => c.name === 'Messages');
        expect(msgs?.type).toBe('rectangle');
      });

      it('assigns parentId to components inside packages', () => {
        const gw = components.find(c => c.alias === 'GW');
        expect(gw?.parentIds).toEqual(['🌐 Operation']);

        const pub = components.find(c => c.alias === 'Publication');
        expect(pub?.parentIds).toEqual(['🌐 Exchange']);

        const user = components.find(c => c.name === 'User');
        expect(user?.parentIds).toEqual([]);
      });
    });

    describe('example 2 (class diagram)', () => {
      const components = plantumlExtractor.extractComponents(EXAMPLE_2);
      const names = components.map(c => c.name);

      it('extracts class declarations', () => {
        expect(names).toContain('GenTTSRequest');
        expect(names).toContain('GetTTSRequest');
        expect(names).toContain('File');
        expect(names).toContain('FileSet');
        expect(names).toContain('TTSConfig');
        expect(names).toContain('FileStorageService');
        expect(names).toContain('BinaryFileService');
        expect(names).toContain('TTSService');
        expect(names).toContain('FileController');
        expect(names).toContain('FileSetController');
        expect(names).toContain('TTSController');
        expect(names).toContain('BinaryFileServiceApplication');
        expect(names).toContain('TextToSpeechClient');

        const fileSet = components.find(c => c.name === 'FileSet');
        expect(fileSet?.type).toBe('class');
      });

      it('extracts enum declarations with values', () => {
        expect(names).toContain('Status');
        const statusEnum = components.find(c => c.name === 'Status');
        expect(statusEnum?.type).toBe('enum');
        expect(statusEnum?.stereotype).toBe('enumeration');
        expect(statusEnum?.members).toBeDefined();
        expect(statusEnum!.members!.length).toBe(2);
        expect(statusEnum!.members![0].text).toBe('ACTIVE');
        expect(statusEnum!.members![0].kind).toBe('property');
        expect(statusEnum!.members![1].text).toBe('INACTIVE');
        expect(statusEnum!.members![1].kind).toBe('property');
      });

      it('extracts interface declarations with stereotype', () => {
        expect(names).toContain('FileRepository');
        expect(names).toContain('FileSetRepository');
        expect(names).toContain('TTSConfigRepository');
        const fileRepo = components.find(c => c.name === 'FileRepository');
        expect(fileRepo?.stereotype).toBe('JpaRepository');
        expect(fileRepo?.type).toBe('interface');
      });

      it('assigns parentId to components inside packages', () => {
        const genTTS = components.find(c => c.name === 'GenTTSRequest');
        expect(genTTS?.parentIds).toEqual(['dto']);

        const app = components.find(c => c.name === 'BinaryFileServiceApplication');
        expect(app?.parentIds).toEqual([]);
      });

      it('extracts properties from class bodies', () => {
        const genTTS = components.find(c => c.name === 'GenTTSRequest');
        expect(genTTS?.members).toBeDefined();
        expect(genTTS!.members!.length).toBe(4);
        expect(genTTS!.members!.every(m => m.kind === 'property')).toBe(true);
        expect(genTTS!.members![0].text).toBe('text : String');
        expect(genTTS!.members![1].text).toBe('voice : String');
      });

      it('extracts both properties and methods from class bodies', () => {
        const fileSet = components.find(c => c.name === 'FileSet');
        expect(fileSet?.members).toBeDefined();
        const props = fileSet!.members!.filter(m => m.kind === 'property');
        const methods = fileSet!.members!.filter(m => m.kind === 'method');
        expect(props.length).toBe(2); // id, name
        expect(methods.length).toBe(2); // addFile, removeFile
        expect(methods[0].text).toContain('addFile');
        expect(methods[1].text).toContain('removeFile');
      });

      it('extracts methods from interface bodies', () => {
        const repo = components.find(c => c.name === 'FileSetRepository');
        expect(repo?.members).toBeDefined();
        const methods = repo!.members!.filter(m => m.kind === 'method');
        expect(methods.length).toBe(2); // deleteByName, findByName
      });

      it('extracts {static} modifiers', () => {
        const app = components.find(c => c.name === 'BinaryFileServiceApplication');
        expect(app?.members).toBeDefined();
        expect(app!.members!.length).toBe(1);
        expect(app!.members![0].isStatic).toBe(true);
        expect(app!.members![0].kind).toBe('method');
        expect(app!.members![0].text).toContain('main');
      });

      it('returns undefined members for empty class bodies', () => {
        const fileRepo = components.find(c => c.name === 'FileRepository');
        // FileRepository has an empty body `{ }`
        expect(fileRepo?.members).toBeUndefined();
      });

      it('returns undefined members for elements without bodies', () => {
        const ttsClient = components.find(c => c.name === 'TextToSpeechClient');
        expect(ttsClient?.members).toBeUndefined();
      });
    });

    describe('example 3 (urbanization map)', () => {
      const source = `
        @startuml
        rectangle "Operational Zone" <<zone>> {
            rectangle "Discovery Experience" <<district>> {
                rectangle "Fuzzy Search" <<block>>
            }
        }
        @enduml
      `;

      it('does not duplicate container rectangles as components', () => {
        const components = plantumlExtractor.extractComponents(source);
        const names = components.map(c => c.name);

        // Zones and districts should NOT be in the components array
        expect(names).not.toContain('Operational Zone');
        expect(names).not.toContain('Discovery Experience');

        // Only the block should be extracted as a leaf component
        expect(names).toContain('Fuzzy Search');

        const block = components.find(c => c.name === 'Fuzzy Search');
        expect(block?.stereotype).toBe('block');
        expect(block?.parentIds).toEqual(['Discovery Experience']);
        expect(block?.type).toBe('rectangle');
      });
    });

    it('extracts visibility markers from class members', () => {
      const source = `
class Foo {
  +publicField : String
  -privateField : int
  #protectedField : boolean
  ~packageField : double
  +publicMethod() : void
  -privateMethod() : void
}`;
      const components = plantumlExtractor.extractComponents(source);
      const foo = components.find(c => c.name === 'Foo');
      expect(foo?.members).toBeDefined();
      expect(foo!.members!.length).toBe(6);
      expect(foo!.members![0].visibility).toBe('+');
      expect(foo!.members![0].text).toBe('publicField : String');
      expect(foo!.members![1].visibility).toBe('-');
      expect(foo!.members![2].visibility).toBe('#');
      expect(foo!.members![3].visibility).toBe('~');
      expect(foo!.members![4].kind).toBe('method');
      expect(foo!.members![4].visibility).toBe('+');
      expect(foo!.members![5].kind).toBe('method');
      expect(foo!.members![5].visibility).toBe('-');
    });

    it('returns empty array for empty source', () => {
      expect(plantumlExtractor.extractComponents('')).toEqual([]);
    });

    it('does not duplicate components with the same alias', () => {
      const source = `
component "A" as MyAlias
component "B" as MyAlias
`;
      const result = plantumlExtractor.extractComponents(source);
      const aliased = result.filter(c => c.alias === 'MyAlias');
      expect(aliased).toHaveLength(1);
    });

    it('collects multiple parentIds when component is defined in multiple containers', () => {
      const source = `
package "Structure" {
    component "API" as Api
}

package "TrustBoundary" {
    component "API" as Api
}
`;
      const result = plantumlExtractor.extractComponents(source);
      const api = result.find(c => c.alias === 'Api');
      expect(api).toBeDefined();
      expect(api!.parentIds).toEqual(['Structure', 'TrustBoundary']);
      // First definition wins for name/type
      expect(api!.name).toBe('API');
    });

    it('uses first definition type/stereotype on conflict', () => {
      const source = `
package "A" {
    database "Store" <<primary>>
}

package "B" {
    component "Store" <<backup>>
}
`;
      const result = plantumlExtractor.extractComponents(source);
      const store = result.find(c => c.name === 'Store');
      expect(store!.type).toBe('database');
      expect(store!.stereotype).toBe('primary');
      expect(store!.parentIds).toEqual(['A', 'B']);
    });
  });

  describe('extractContainers', () => {

    it('extracts top-level packages', () => {
      const containers = plantumlExtractor.extractContainers(EXAMPLE_1);
      const labels = containers.map(c => c.label);

      expect(labels).toContain('🌐 Operation');
      expect(labels).toContain('🌐 Exchange');
      expect(labels).toContain('🌐 Reference');
      expect(labels).toContain('🌐 Data Repository');
    });

    it('extracts packages from class diagram', () => {
      const containers = plantumlExtractor.extractContainers(EXAMPLE_2);
      const ids = containers.map(c => c.id);

      expect(ids).toContain('dto');
      expect(ids).toContain('model');
      expect(ids).toContain('repository');
      expect(ids).toContain('service');
      expect(ids).toContain('controller');
    });

    it('handles nested containers with parentId', () => {
      const source = `
package "Outer" {
    package "Inner" {
        component "X"
    }
}`;
      const containers = plantumlExtractor.extractContainers(source);
      expect(containers).toHaveLength(2);

      const inner = containers.find(c => c.label === 'Inner');
      expect(inner?.parentId).toBe('Outer'); // container parentId (not component parentIds)

      const outer = containers.find(c => c.label === 'Outer');
      expect(outer?.parentId).toBeUndefined(); // container parentId (not component parentIds)
    });

    it('returns empty array when no containers', () => {
      const source = `component "A"\ncomponent "B"`;
      expect(plantumlExtractor.extractContainers(source)).toEqual([]);
    });

    it('deduplicates containers with the same id across blocks', () => {
      const source = `
package "Shared" {
    component "A"
}

package "Shared" {
    component "B"
}
`;
      const containers = plantumlExtractor.extractContainers(source);
      const shared = containers.filter(c => c.id === 'Shared');
      expect(shared).toHaveLength(1);
    });
  });

  describe('extractRelations', () => {

    it('extracts simple relations', () => {
      const relations = plantumlExtractor.extractRelations(EXAMPLE_1);
      expect(relations.length).toBeGreaterThan(0);

      // MSKeycloak --> MOM
      const r = relations.find(r => r.from === 'MSKeycloak' && r.to === 'MOM');
      expect(r).toBeDefined();
      expect(r?.lineStyle).toBe('solid');
      expect(r?.startArrow).toBeUndefined();
      expect(r?.endArrow).toBe('arrow');
    });

    it('extracts relations with labels', () => {
      const relations = plantumlExtractor.extractRelations(EXAMPLE_1);

      // KiaoNotes --> Publication : REST
      const r = relations.find(r => r.from === 'KiaoNotes' && r.to === 'Publication');
      expect(r).toBeDefined();
      expect(r!.label).toBe('REST');
    });

    it('handles reversed arrows (<-- becomes from right to left)', () => {
      const relations = plantumlExtractor.extractRelations(EXAMPLE_1);

      // MSCatalog <-- MOM → from: MOM, to: MSCatalog
      const r = relations.find(r => r.from === 'MOM' && r.to === 'MSCatalog');
      expect(r).toBeDefined();
      expect(r?.lineStyle).toBe('solid');
      expect(r?.startArrow).toBeUndefined();
      expect(r?.endArrow).toBe('arrow');
    });

    it('extracts class diagram associations', () => {
      const relations = plantumlExtractor.extractRelations(EXAMPLE_2);
      // FileSet "*" -- "*" File : files — note: quoted cardinalities may not match as identifiers
      // but simple A -- B should work
      expect(relations.length).toBeGreaterThan(0);
      const r1 = relations.find(r => r.from === 'FileSet');
      expect(r1).toBeDefined();
      expect(r1?.lineStyle).toBe('solid');
      expect(r1?.startArrow).toBeUndefined();
      expect(r1?.endArrow).toBeUndefined();
    });

    it('extracts different line styles and arrows', () => {
      const source = `
        A ..> B
        C *-- D
        E o-- F
        G <|-- H
        I <|.. J
        `;
      const relations = plantumlExtractor.extractRelations(source);

      const r1 = relations.find(r => r.from === 'A' && r.to === 'B');
      expect(r1?.lineStyle).toBe('dashed');
      expect(r1?.startArrow).toBeUndefined();
      expect(r1?.endArrow).toBe('arrow');

      const r2 = relations.find(r => r.from === 'C' && r.to === 'D');
      expect(r2?.lineStyle).toBe('solid');
      expect(r2?.startArrow).toBe('diamond-filled');
      expect(r2?.endArrow).toBeUndefined();

      const r3 = relations.find(r => r.from === 'E' && r.to === 'F');
      expect(r3?.lineStyle).toBe('solid');
      expect(r3?.startArrow).toBe('diamond');
      expect(r3?.endArrow).toBeUndefined();

      const r4 = relations.find(r => r.from === 'G' && r.to === 'H');
      expect(r4?.lineStyle).toBe('solid');
      expect(r4?.startArrow).toBe('triangle');
      expect(r4?.endArrow).toBeUndefined();

      const r5 = relations.find(r => r.from === 'I' && r.to === 'J');
      expect(r5?.lineStyle).toBe('dashed');
      expect(r5?.startArrow).toBe('triangle');
      expect(r5?.endArrow).toBeUndefined();
    });

    it('returns empty array for source without relations', () => {
      const source = `component "A"\ncomponent "B"`;
      expect(plantumlExtractor.extractRelations(source)).toEqual([]);
    });
  });

  describe('rank hints', () => {

    const hintOf = (line: string) => plantumlExtractor.extractRelations(line)[0]?.rankHint;

    it('leaves a plain relation without one — down is what a relation does', () => {
      expect(hintOf('A --> B')).toBeUndefined();
      expect(hintOf('A -down-> B')).toBeUndefined();
    });

    it('reads the direction written in the arrow', () => {
      expect(hintOf('A -up-> B')).toBe('up');
      expect(hintOf('A -left-> B')).toBe('left');
      expect(hintOf('A -right-> B')).toBe('right');
    });

    it('accepts the one-letter forms', () => {
      expect(hintOf('A -u-> B')).toBe('up');
      expect(hintOf('A -r-> B')).toBe('right');
    });

    it('mirrors the hint when the arrow points back', () => {
      // `A <-- B` is written A first, so A stays above B: read from B, that is up.
      expect(hintOf('A <-- B')).toBe('up');
      // `A <-up- B` puts B above A, which read from B is the default again.
      expect(hintOf('A <-up- B')).toBeUndefined();
      expect(hintOf('A <-left- B')).toBe('right');
    });

    it('leaves an inheritance arrow ranking from the parent down', () => {
      expect(hintOf('Shape <|-- Circle')).toBeUndefined();
      expect(plantumlExtractor.extractRelations('Shape <|-- Circle')[0].from).toBe('Shape');
    });

    it('reads `norank` as neither above nor below', () => {
      expect(hintOf('A -[norank]-> B')).toBe('none');
      expect(hintOf('A -[#red,norank]-> B')).toBe('none');
    });

    it('does not mistake a style block for a direction', () => {
      expect(hintOf('A -[thickness=3,#orange]- B')).toBeUndefined();
    });
  });

  describe('extractPlantUmlDirection', () => {

    it('is top to bottom unless the source says otherwise', () => {
      expect(extractPlantUmlDirection('@startuml\nrectangle A\n@enduml')).toBe('TB');
    });

    it('reads `left to right direction`', () => {
      expect(extractPlantUmlDirection('@startuml\nleft to right direction\nrectangle A')).toBe('LR');
    });

    it('reads C4 layout macros', () => {
      expect(extractPlantUmlDirection('LAYOUT_LEFT_RIGHT()')).toBe('LR');
      expect(extractPlantUmlDirection('LAYOUT_LEFT_RIGHT()\nLAYOUT_TOP_DOWN()')).toBe('TB');
    });

    it('ignores a directive that is commented out', () => {
      expect(extractPlantUmlDirection("@startuml\n' left to right direction\nrectangle A")).toBe('TB');
    });
  });
});
