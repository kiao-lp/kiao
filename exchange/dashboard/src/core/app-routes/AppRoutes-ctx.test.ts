import { matchAppRoute, AppRouteDeclaration } from './AppRoutes-ctx';

const route = (prefix: string): AppRouteDeclaration => ({ prefix, render: () => null });

describe('matchAppRoute', () => {
    const routes = [route('/boards')];

    it('claims the prefix itself, which is the page that lists them', () => {
        expect(matchAppRoute(routes, '/boards')).toEqual({ route: routes[0], rest: '' });
    });

    it('claims everything under it, and hands over what is left', () => {
        expect(matchAppRoute(routes, '/boards/major')).toEqual({ route: routes[0], rest: 'major' });
        expect(matchAppRoute(routes, '/boards/tech-debt/')).toEqual({ route: routes[0], rest: 'tech-debt/' });
    });

    it('leaves a document alone, including one whose name merely starts the same way', () => {
        expect(matchAppRoute(routes, '/docs/plan.md')).toBeNull();
        expect(matchAppRoute(routes, '/boardsomething/x.md')).toBeNull();
    });

    it('gives the longest claim the page', () => {
        const nested = [route('/boards'), route('/boards/archive')];
        expect(matchAppRoute(nested, '/boards/archive/2025')?.route.prefix).toBe('/boards/archive');
        expect(matchAppRoute(nested, '/boards/major')?.route.prefix).toBe('/boards');
    });

    it('claims nothing when no plugin claimed anything', () => {
        expect(matchAppRoute([], '/boards')).toBeNull();
    });
});
