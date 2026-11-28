import type { GatewayRoute } from './service/types';

export const readRoutes = (raw: unknown, linked: string[]): GatewayRoute[] | undefined => {
    if (!Array.isArray(raw)) return undefined;
    const routes: GatewayRoute[] = raw.filter(route => route && typeof route.condition === 'string'
        && typeof route.flowNode === 'string' && linked.includes(route.flowNode))
        .map(({ condition, flowNode }) => ({ condition, flowNode }));
    return routes.length ? routes : undefined;
};
