import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { MenuProps } from 'antd';
import { ContextMenuItemDescriptor, ContextMenuRegistry, ContextMenuContext } from './ContextMenuRegistry';

const RegistryContext = createContext<ContextMenuRegistry | null>(null);

export const ContextMenuRegistryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const registry = useMemo(() => new ContextMenuRegistry(), []);
    return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>;
};

export const useContextMenuRegistry = (): ContextMenuRegistry => {
    const registry = useContext(RegistryContext);
    if (!registry) throw new Error('useContextMenuRegistry must be used within a ContextMenuRegistryProvider');
    return registry;
};

export const useContextMenuItemsAt = (ctx: ContextMenuContext): MenuProps['items'] => {
    const registry = useContextMenuRegistry();
    const [tick, setTick] = useState(0);

    useEffect(() => registry.subscribe(() => setTick(t => t + 1)), [registry]);

    return useMemo(() => {
        const descriptors = registry.getItems(ctx);
        const items: NonNullable<MenuProps['items']> = [];
        let prevGroup: string | undefined = undefined;
        descriptors.forEach((d, idx) => {
            if (idx > 0 && d.group !== prevGroup) {
                items.push({ type: 'divider', key: `sep-${d.id}` });
            }
            prevGroup = d.group;
            items.push({
                key: d.id,
                label: d.label,
                icon: d.icon,
                danger: d.danger,
                onClick: (e) => {
                    e.domEvent.stopPropagation();
                    d.execute(ctx);
                },
            });
        });
        return items;
    }, [registry, tick, ctx]);
};
