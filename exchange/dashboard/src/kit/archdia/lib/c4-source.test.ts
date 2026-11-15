import { describe, it, expect } from 'vitest';
import { plantumlExtractor } from './diagram-source';
import { parseC4MacroCall, parseC4RelationTags } from './c4-source';

const C4_CONTEXT = `@startuml Elastic Path - Target System Context
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Context.puml

left to right direction

LAYOUT_WITH_LEGEND()

' Highlight open architecture decisions in amber (currently none at this level —
' the download-service decision was settled on 23 Jul 2026; keep the tags for future use)
AddElementTag("decision", $bgColor="#FFF2CC", $borderColor="#D6B656", $fontColor="#7F6000", $legendText="Decision to be made")
AddRelTag("decision", $lineColor="#D6B656", $textColor="#7F6000", $lineStyle=DashedLine())

title Elastic Path

Person(customer, "Customer", "Buys standards, manages subscriptions")
Person(customer_service, "Customer Service", "Handles cases and price updates")
Person(distribution_logistics, "Distribution & Logistics", "Processes hard-copy orders")

Enterprise_Boundary(elastic_path, "Elastic Path") {
    System(storefront, "Storefront", "Commerce storefront: browsing, cart & checkout experience")
    System(composable_cloud, "Composable Cloud", "Commerce backend: orders, subscriptions, PXM, billing & payments; source of truth for entitlements")
}

System_Ext(keycloak, "Keycloak", "Central IAM / SSO")
System_Ext(bootiful_services, "Bootiful Services", "National-member opt-out registry")
System_Ext(datahive, "Datahive", "BI dashboards & reporting")
System_Ext(iso_org, "ISO.org", "Public website / basket entry")
System_Ext(support_crm, "ISO Support / CRM", "Support case management")
System_Ext(psp, "PSP", "Payment service provider")
System_Ext(fibalpack, "Fibalpack", "Hard-copy print/ship provider")
System_Ext(obp_plus, "OBP Plus", "Standards browsing, preview & entitled reading; keeps its own entitlement records (fed by Kafka). Graphical symbols are NOT displayed here")
System_Ext(product_pricing_service, "Product & Pricing Service", "Computes & historises products and prices; emits 'product changed' events (system of record)")
System_Ext(business_central, "Business Central", "ERP: finance, daily aggregates & reconciliation")
System_Ext(product_download_service, "Product Download Service", "Stateless download of purchased products (PDF, ePub, …): validates the signed JWT link, fetches the document from ICE, applies the watermark. No entitlement store")
System_Ext(ice, "ICE", "Source documents (PDF, ePub, …) and authoritative graphical-symbol metadata API")

' People → Elastic Path
Rel(customer, storefront, "Browses & orders", "HTTPS")
Rel(customer_service, composable_cloud, "Handles cases, price updates", "HTTPS")
Rel(distribution_logistics, composable_cloud, "Processes hard-copy orders", "HTTPS")

' Elastic Path → People
Rel(composable_cloud, customer, "Sends invoices, renewals, entitlement & seat-invitation emails", "Email")

' External Systems → People
Rel(product_download_service, customer, "Returns the watermarked document", "HTTPS")

' Storefront ↔ Composable Cloud
Rel(storefront, composable_cloud, "Submits orders, reads catalogue & prices", "REST")

' Storefront → External Systems
Rel(storefront, keycloak, "Authenticates customers", "OIDC")
Rel(storefront, obp_plus, "Redirects buyers to read purchased standards", "HTTPS")
Rel(storefront, product_download_service, "Delegates product downloads via a signed JWT link (shared secret)", "HTTPS")

' Composable Cloud → External Systems
Rel(composable_cloud, support_crm, "Links accounts to cases", "REST")
Rel(composable_cloud, psp, "Processes payments", "HTTPS")
Rel(composable_cloud, bootiful_services, "Checks opt-out eligibility", "REST")
Rel(composable_cloud, datahive, "Provides commerce data", "Events")
Rel(composable_cloud, fibalpack, "Sends print/ship orders", "File / API")
Rel(composable_cloud, product_pricing_service, "Reads product & price details", "REST")
Rel(composable_cloud, obp_plus, "Publishes entitlement events (OBP updates its own records; no real-time query back)", "Events / Kafka")
Rel(composable_cloud, keycloak, "Publishes new account members for user provisioning", "Events / Kafka")

' Product Download Service → External Systems
Rel(product_download_service, ice, "Fetches source documents", "REST")

' External Systems → Elastic Path
Rel(product_pricing_service, composable_cloud, "Publishes 'product changed'", "Event")
Rel(product_pricing_service, ice, "Fetches formats & graphical-symbol metadata", "REST")
Rel(iso_org, storefront, "Redirects basket to store", "HTTPS")
Rel(obp_plus, storefront, "Redirects users to purchase", "HTTPS")

' DataHive → Business Central
Rel(datahive, business_central, "Pushes daily aggregates & reconciliation", "Batch")

@enduml`;

describe('parseC4MacroCall', () => {
    it('parses a macro call with positional arguments', () => {
        const call = parseC4MacroCall('Person(customer, "Customer", "Buys standards")');
        expect(call?.name).toBe('Person');
        expect(call?.positional).toEqual(['customer', 'Customer', 'Buys standards']);
        expect(call?.opensScope).toBe(false);
    });

    it('keeps commas and parentheses that appear inside quoted arguments', () => {
        const call = parseC4MacroCall('System_Ext(ice, "ICE", "Documents (PDF, ePub), and metadata API")');
        expect(call?.positional).toEqual(['ice', 'ICE', 'Documents (PDF, ePub), and metadata API']);
    });

    it('parses named arguments without the leading $', () => {
        const call = parseC4MacroCall('Rel(a, b, "Label", "REST", $tags="decision")');
        expect(call?.positional).toEqual(['a', 'b', 'Label', 'REST']);
        expect(call?.named).toEqual({ tags: 'decision' });
    });

    it('detects a scope-opening brace', () => {
        const call = parseC4MacroCall('Enterprise_Boundary(ep, "Elastic Path") {');
        expect(call?.opensScope).toBe(true);
    });

    it('handles nested macro calls in named arguments', () => {
        const call = parseC4MacroCall('AddRelTag("decision", $lineStyle=DashedLine())');
        expect(call?.positional).toEqual(['decision']);
        expect(call?.named.lineStyle).toBe('DashedLine()');
    });

    it('returns undefined for lines that are not macro calls', () => {
        expect(parseC4MacroCall('left to right direction')).toBeUndefined();
        expect(parseC4MacroCall('component "Gateway" as GW')).toBeUndefined();
        expect(parseC4MacroCall("' Rel(a, b, \"commented out\")")).toBeUndefined();
    });

    it('parses a call with an empty argument list', () => {
        const call = parseC4MacroCall('LAYOUT_WITH_LEGEND()');
        expect(call?.name).toBe('LAYOUT_WITH_LEGEND');
        expect(call?.positional).toEqual([]);
    });
});

describe('C4 components', () => {
    it('maps Person to an actor', () => {
        const [comp] = plantumlExtractor.extractComponents('Person(customer, "Customer", "Buys standards")');
        expect(comp).toMatchObject({
            name: 'Customer',
            alias: 'customer',
            type: 'actor',
            description: 'Buys standards',
        });
        expect(comp.external).toBeUndefined();
    });

    it('marks _Ext elements as external', () => {
        const [comp] = plantumlExtractor.extractComponents('System_Ext(psp, "PSP", "Payment service provider")');
        expect(comp).toMatchObject({ name: 'PSP', type: 'rectangle', external: true });
    });

    it('maps Db and Queue variants to their shapes', () => {
        const components = plantumlExtractor.extractComponents(`
SystemDb(db, "Store")
SystemQueue(bus, "Bus")
ContainerDb(cdb, "Catalog DB", "PostgreSQL")
ContainerQueue(cq, "Events", "Kafka")
`);
        expect(components.map(c => c.type)).toEqual(['database', 'queue', 'database', 'queue']);
    });

    it('reads the third argument as technology for Container and Component', () => {
        const components = plantumlExtractor.extractComponents(`
Container(api, "API", "Spring Boot", "Serves the REST API")
Component(repo, "Repository", "JPA", "Persists entities")
`);
        expect(components[0]).toMatchObject({ stereotype: 'Spring Boot', description: 'Serves the REST API' });
        expect(components[1]).toMatchObject({ stereotype: 'JPA', description: 'Persists entities' });
    });

    it('reads the third argument as description for Person and System', () => {
        const [comp] = plantumlExtractor.extractComponents('System(store, "Storefront", "Cart & checkout")');
        expect(comp.stereotype).toBeUndefined();
        expect(comp.description).toBe('Cart & checkout');
    });

    it('falls back to the alias when no label is given', () => {
        const [comp] = plantumlExtractor.extractComponents('System(storefront)');
        expect(comp).toMatchObject({ name: 'storefront', alias: 'storefront' });
    });

    it('renders a boundary macro without braces as a plain box', () => {
        const [comp] = plantumlExtractor.extractComponents('System_Boundary(empty, "Nothing inside")');
        expect(comp).toMatchObject({ name: 'Nothing inside', alias: 'empty', type: 'rectangle' });
    });

    it('ignores directives, tag declarations and layout hints', () => {
        const components = plantumlExtractor.extractComponents(`
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Context.puml
LAYOUT_WITH_LEGEND()
SHOW_LEGEND()
AddElementTag("decision", $bgColor="#FFF2CC")
UpdateElementStyle(person, $bgColor="#000000")
title Elastic Path
`);
        expect(components).toEqual([]);
    });

    it('mixes C4 macros with native PlantUML elements', () => {
        const components = plantumlExtractor.extractComponents(`
@startuml
component "Gateway" as GW
System(store, "Storefront")
@enduml`);
        expect(components.map(c => c.alias)).toEqual(['GW', 'store']);
    });
});

describe('C4 boundaries', () => {
    const SOURCE = `
Enterprise_Boundary(elastic_path, "Elastic Path") {
    System(storefront, "Storefront")
    System_Boundary(inner, "Inner") {
        Container(api, "API", "Spring Boot")
    }
}
System_Ext(psp, "PSP")
`;

    it('extracts boundaries as containers with a stereotype', () => {
        const containers = plantumlExtractor.extractContainers(SOURCE);
        expect(containers).toEqual([
            { id: 'elastic_path', label: 'Elastic Path', stereotype: 'enterprise', parentId: undefined, description: undefined },
            { id: 'inner', label: 'Inner', stereotype: 'system', parentId: 'elastic_path', description: undefined },
        ]);
    });

    it('assigns enclosed elements to their boundary', () => {
        const components = plantumlExtractor.extractComponents(SOURCE);
        const parentOf = (alias: string) => components.find(c => c.alias === alias)?.parentIds;
        expect(parentOf('storefront')).toEqual(['elastic_path']);
        expect(parentOf('api')).toEqual(['inner']);
        expect(parentOf('psp')).toEqual([]);
    });

    it('reads the boundary type and description of generic and deployment boundaries', () => {
        const containers = plantumlExtractor.extractContainers(`
Boundary(net, "Network", "Zone") {
    System(a, "A")
}
Node(server, "Server", "Debian 12", "Hosts the stack") {
    Container(app, "App", "Docker")
}
`);
        expect(containers[0]).toMatchObject({ id: 'net', label: 'Network', stereotype: 'Zone' });
        expect(containers[1]).toMatchObject({ id: 'server', stereotype: 'Debian 12', description: 'Hosts the stack' });
    });

    it('keeps native PlantUML packages working alongside boundaries', () => {
        const containers = plantumlExtractor.extractContainers(`
package "Legacy" as legacy {
    component "Old" as Old
}
System_Boundary(modern, "Modern") {
    System(new, "New")
}
`);
        expect(containers.map(c => c.id)).toEqual(['legacy', 'modern']);
    });
});

describe('C4 relations', () => {
    it('extracts a relation with its technology on a second line', () => {
        const [rel] = plantumlExtractor.extractRelations('Rel(storefront, keycloak, "Authenticates customers", "OIDC")');
        expect(rel).toMatchObject({
            from: 'storefront',
            to: 'keycloak',
            label: 'Authenticates customers\n[OIDC]',
            lineStyle: 'solid',
            endArrow: 'arrow',
        });
        expect(rel.startArrow).toBeUndefined();
    });

    it('omits the technology line when absent', () => {
        const [rel] = plantumlExtractor.extractRelations('Rel(a, b, "Calls")');
        expect(rel.label).toBe('Calls');
    });

    it('treats direction suffixes as plain relations', () => {
        const relations = plantumlExtractor.extractRelations(`
Rel_Up(a, b, "up")
Rel_D(a, c, "down")
Rel_Neighbor(a, d, "neighbor")
`);
        expect(relations.map(r => [r.from, r.to])).toEqual([['a', 'b'], ['a', 'c'], ['a', 'd']]);
    });

    it('reverses Rel_Back', () => {
        const [rel] = plantumlExtractor.extractRelations('Rel_Back(a, b, "answers")');
        expect(rel).toMatchObject({ from: 'b', to: 'a', endArrow: 'arrow' });
    });

    it('puts arrowheads on both ends of BiRel', () => {
        const [rel] = plantumlExtractor.extractRelations('BiRel(a, b, "syncs")');
        expect(rel).toMatchObject({ from: 'a', to: 'b', startArrow: 'arrow', endArrow: 'arrow' });
    });

    it('carries the relation description', () => {
        const [rel] = plantumlExtractor.extractRelations('Rel(a, b, "Calls", "REST", "Retries three times")');
        expect(rel.description).toBe('Retries three times');
    });

    it('ignores Lay_* layout hints', () => {
        expect(plantumlExtractor.extractRelations('Lay_D(a, b)\nLay_Distance(a, b, 2)')).toEqual([]);
    });

    it('keeps native PlantUML arrows working alongside C4 relations', () => {
        const relations = plantumlExtractor.extractRelations(`
GW --> Auth : authenticate
Rel(storefront, psp, "Pays")
`);
        expect(relations.map(r => [r.from, r.to])).toEqual([['GW', 'Auth'], ['storefront', 'psp']]);
    });
});

describe('C4 relation tags', () => {
    const TAGGED = `
AddRelTag("decision", $lineColor="#D6B656", $textColor="#7F6000", $lineStyle=DashedLine())
AddRelTag("bold", $lineColor="red", $lineThickness=4)
Rel(a, b, "Undecided", "REST", $tags="decision")
Rel(a, c, "Heavy", $tags="bold")
Rel(a, d, "Plain")
`;

    it('collects styles declared with AddRelTag', () => {
        const tags = parseC4RelationTags(TAGGED);
        expect(tags.get('decision')).toEqual({ color: '#D6B656', lineStyle: 'dashed' });
        expect(tags.get('bold')).toEqual({ color: 'red', weight: 4 });
    });

    it('applies the tag style to tagged relations only', () => {
        const relations = plantumlExtractor.extractRelations(TAGGED);
        expect(relations[0]).toMatchObject({ color: '#D6B656', lineStyle: 'dashed' });
        expect(relations[1]).toMatchObject({ color: 'red', weight: 4 });
        expect(relations[2].color).toBeUndefined();
        expect(relations[2].lineStyle).toBe('solid');
    });
});

describe('C4 context diagram (end to end)', () => {
    const components = plantumlExtractor.extractComponents(C4_CONTEXT);
    const containers = plantumlExtractor.extractContainers(C4_CONTEXT);
    const relations = plantumlExtractor.extractRelations(C4_CONTEXT);

    it('extracts every element exactly once', () => {
        expect(components).toHaveLength(17);
        expect(new Set(components.map(c => c.alias)).size).toBe(17);
    });

    it('separates people, internal systems and external systems', () => {
        expect(components.filter(c => c.type === 'actor').map(c => c.alias))
            .toEqual(['customer', 'customer_service', 'distribution_logistics']);
        expect(components.filter(c => !c.external && c.type === 'rectangle').map(c => c.alias))
            .toEqual(['storefront', 'composable_cloud']);
        expect(components.filter(c => c.external)).toHaveLength(12);
    });

    it('nests the enterprise boundary members', () => {
        expect(containers).toEqual([
            { id: 'elastic_path', label: 'Elastic Path', stereotype: 'enterprise', parentId: undefined, description: undefined },
        ]);
        expect(components.filter(c => c.parentIds?.includes('elastic_path')).map(c => c.alias))
            .toEqual(['storefront', 'composable_cloud']);
    });

    it('keeps long descriptions containing commas and parentheses intact', () => {
        const ice = components.find(c => c.alias === 'ice');
        expect(ice?.description).toBe('Source documents (PDF, ePub, …) and authoritative graphical-symbol metadata API');
    });

    it('extracts every relation and no phantom ones', () => {
        expect(relations).toHaveLength(23);
        expect(relations.every(r => r.endArrow === 'arrow')).toBe(true);
        expect(relations[0]).toMatchObject({
            from: 'customer',
            to: 'storefront',
            label: 'Browses & orders\n[HTTPS]',
        });
    });

    it('resolves every relation endpoint to a declared element', () => {
        const keys = new Set([
            ...components.map(c => c.alias || c.name),
            ...containers.map(c => c.id),
        ]);
        const dangling = relations.filter(r => !keys.has(r.from) || !keys.has(r.to));
        expect(dangling).toEqual([]);
    });
});

describe('C4 rank hints', () => {

  const hintOf = (line: string) => plantumlExtractor.extractRelations(line)[0]?.rankHint;

  it('leaves a plain Rel without one', () => {
    expect(hintOf('Rel(a, b, "Uses")')).toBeUndefined();
  });

  it('reads the direction suffix', () => {
    expect(hintOf('Rel_U(a, b, "Uses")')).toBe('up');
    expect(hintOf('Rel_Right(a, b, "Uses")')).toBe('right');
  });

  it('reads _Neighbor as one shared rank', () => {
    expect(hintOf('Rel_Neighbor(a, b, "Uses")')).toBe('none');
    expect(hintOf('Rel_Back_Neighbor(a, b, "Uses")')).toBe('none');
  });

  it('keeps the first element written above the second under Rel_Back', () => {
    // `Rel_Back(a, b)` runs from b to a, and still asks for a above b.
    const relation = plantumlExtractor.extractRelations('Rel_Back(a, b, "Sends to")')[0];
    expect(relation.from).toBe('b');
    expect(relation.to).toBe('a');
    expect(relation.rankHint).toBe('up');
  });

  it('mirrors a direction suffix along with Rel_Back', () => {
    expect(hintOf('Rel_Back_U(a, b, "Uses")')).toBeUndefined();
    expect(hintOf('Rel_Back_L(a, b, "Uses")')).toBe('right');
  });
});
