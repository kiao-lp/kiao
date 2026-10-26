import { describe, it, expect } from 'vitest';
import { plantumlExtractor } from './diagram-source';

describe('plantumlExtractor styling', () => {
    describe('extractRelations with styles', () => {
        it('extracts color from relation', () => {
            const source = 'A -[#red]-> B';
            const relations = plantumlExtractor.extractRelations(source);
            expect(relations).toHaveLength(1);
            expect(relations[0].color).toBe('red');
            expect(relations[0].from).toBe('A');
            expect(relations[0].to).toBe('B');
        });

        it('extracts hex color from relation', () => {
            const source = 'A -[#00ff00]-> B';
            const relations = plantumlExtractor.extractRelations(source);
            expect(relations).toHaveLength(1);
            expect(relations[0].color).toBe('#00ff00');
        });

        it('extracts thickness as weight', () => {
            const source = 'A -[thickness=5]-> B';
            const relations = plantumlExtractor.extractRelations(source);
            expect(relations).toHaveLength(1);
            expect(relations[0].weight).toBe(5);
        });

        it('handles bold as thickness 3', () => {
            const source = 'A -[bold]-> B';
            const relations = plantumlExtractor.extractRelations(source);
            expect(relations).toHaveLength(1);
            expect(relations[0].weight).toBe(3);
        });

        it('extracts both color and weight', () => {
            const source = 'A -[#blue,thickness=2]-> B';
            const relations = plantumlExtractor.extractRelations(source);
            expect(relations).toHaveLength(1);
            expect(relations[0].color).toBe('blue');
            expect(relations[0].weight).toBe(2);
        });

        it('handles style in dashed arrows', () => {
            const source = 'A .[#red,thickness=4].> B';
            const relations = plantumlExtractor.extractRelations(source);
            expect(relations).toHaveLength(1);
            expect(relations[0].lineStyle).toBe('dashed');
            expect(relations[0].color).toBe('red');
            expect(relations[0].weight).toBe(4);
        });

        it('handles styles with directions', () => {
            const source = 'A -up[#red]-> B';
            const relations = plantumlExtractor.extractRelations(source);
            expect(relations).toHaveLength(1);
            expect(relations[0].color).toBe('red');
        });

        it('handles styles with composite arrows', () => {
            const source = 'A <|-[#blue]- B';
            const relations = plantumlExtractor.extractRelations(source);
            expect(relations).toHaveLength(1);
            expect(relations[0].color).toBe('blue');
            expect(relations[0].startArrow).toBe('triangle');
        });

        it('handles styles with labels', () => {
            const source = 'A -[#red]-> B : link';
            const relations = plantumlExtractor.extractRelations(source);
            expect(relations).toHaveLength(1);
            expect(relations[0].color).toBe('red');
            expect(relations[0].label).toBe('link');
        });
    });
});
