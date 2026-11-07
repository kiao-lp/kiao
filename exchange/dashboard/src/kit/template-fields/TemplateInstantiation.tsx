import React, { useMemo } from 'react';
import { Button, Checkbox } from 'antd';
import { ConfiguredMarkdown } from '@cms-core';
import {
    collectRenderNodesFromAll, instantiateTemplate, KiaoElHeap, RenderNode,
    TemplateCollectionV0,
} from '@cms-kit/template-lang';
import { ConfigValuesProvider } from './ConfigValues-ctx';
import { HeapContext, ValueField } from './ValueField';
import { useGlobalTemplateStore } from './GlobalTemplateStore';
import styles from './TemplateInstantiation.module.css';

export interface TemplateInstantiationProps {
    /** The template being instantiated. */
    template: TemplateCollectionV0;
    /**
     * The values the caller fills itself, merged over the shared answers on the way to the
     * preview — a flow node's title and description, a class's title. Filled rather than asked:
     * the keys named here are not drawn, and they are never kept among the answers the
     * application shares.
     */
    bound?: KiaoElHeap;
    /** The instantiated text: into a file, a flow node's description, a class version's body. */
    onInstantiate: (text: string) => void;
    /**
     * Where the instantiated text has somewhere to go that is not the clipboard — a flow node's
     * description, a class version's body — the Copy button is off.
     */
    copyDisabled?: boolean;
}

/**
 * A template's variables, and the checkboxes its optional sections are. The keys the caller
 * bound are not drawn: a box holding the description that is on screen behind the panel is a
 * question nobody was asked.
 */
const TemplateFields: React.FC<{
    nodes: RenderNode[];
    hidden: Set<string>;
    onToggle: (key: string, enabled: boolean) => void;
}> = ({ nodes, hidden, onToggle }) => (
    <>
        {nodes.filter(node => !hidden.has(node.key)).map(node => (node.type === 'group' ? (
            <div key={node.token} className={styles.templateGroup}>
                {node.hasDefault ? (
                    <Checkbox
                        checked={node.isEnabled}
                        onChange={event => onToggle(node.key, event.target.checked)}
                    >
                        {node.key}
                    </Checkbox>
                ) : (
                    <div className={styles.templateSection}>{node.key}</div>
                )}
                {node.isEnabled && node.children && (
                    <TemplateFields nodes={node.children} hidden={hidden} onToggle={onToggle} />
                )}
            </div>
        ) : (
            <ValueField key={node.token} kbElExpr={node.token} />
        )))}
    </>
);

/**
 * Instantiating a template: answer what it asks on the left, read what it makes on the right,
 * and Instantiate hands the text over — or Copy takes it to the clipboard.
 *
 * The one instantiation component of the CMS, used wherever a template is filled in: the
 * Preview of a `.temp.md` file being edited, a flow node's description written from a template,
 * a class version's body in the instantiation wizard. What differs per caller is only what
 * Instantiate is wired to and whether Copy is on.
 *
 * Templates are always markdown, so the preview is always rendered markdown — there is no
 * source view to switch to. What Instantiate hands over is the markdown source it was rendered
 * from.
 *
 * **The answers are the application's, not this panel's.** They are held in the same store
 * whichever template fills (`GlobalTemplateStore`), so a value typed here is the value the next
 * instantiation opens with, wherever it is asked for. What is *not* shared is what the caller
 * bound: merged in on the way to the preview and left out of the store.
 */
export const TemplateInstantiation: React.FC<TemplateInstantiationProps> = ({
    template, bound, onInstantiate, copyDisabled,
}) => {
    const { heap, setHeap, enabledMap, setEnabledMap } = useGlobalTemplateStore();

    const nodes = useMemo(
        () => collectRenderNodesFromAll([template], enabledMap),
        [template, enabledMap],
    );

    const hidden = useMemo(() => new Set(Object.keys(bound ?? {})), [bound]);

    const filled = useMemo((): KiaoElHeap => ({ ...heap, ...bound }), [heap, bound]);

    const result = useMemo(
        () => instantiateTemplate(filled, template, enabledMap),
        [filled, template, enabledMap],
    );

    const asked = nodes.filter(node => !hidden.has(node.key));

    return (
        <div className={styles.instantiateBody} data-testid="template-instantiation">
            <ConfigValuesProvider>
                <HeapContext.Provider
                    value={[heap, setHeap as React.Dispatch<React.SetStateAction<KiaoElHeap>>]}
                >
                    {template.index && (
                        <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{template.index}</div>
                    )}
                    <div className={styles.instantiatePanes}>
                        {asked.length > 0 && (
                            <div className={styles.templateFields}>
                                <TemplateFields
                                    nodes={nodes}
                                    hidden={hidden}
                                    onToggle={(key, enabled) =>
                                        setEnabledMap(prev => ({ ...prev, [key]: enabled }))}
                                />
                            </div>
                        )}
                        <div className={styles.templatePreview} data-testid="template-preview">
                            <ConfiguredMarkdown showCopyHtml={true}>{result}</ConfiguredMarkdown>
                        </div>
                    </div>
                    <div className={styles.instantiateFooter}>
                        <Button
                            type="primary"
                            onClick={() => onInstantiate(result)}
                            data-testid="instantiate-confirm"
                        >
                            Instantiate
                        </Button>
                        <Button
                            disabled={copyDisabled}
                            onClick={() => navigator.clipboard.writeText(result)}
                        >
                            Copy
                        </Button>
                    </div>
                </HeapContext.Provider>
            </ConfigValuesProvider>
        </div>
    );
};
