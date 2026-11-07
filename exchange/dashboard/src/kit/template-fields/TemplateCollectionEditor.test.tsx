import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * The CMS's one template editor: the name, the index, the Root and the sub-templates — the
 * Modify face of a `.temp.md` file, and of a class version's body in template mode.
 *
 * What is pinned here is the controlled contract both callers rely on: every edit is the whole
 * collection it makes, handed to `onChange`, and the editor holds nothing itself.
 */

vi.mock('@cms-core', async importOriginal => ({
    ...(await importOriginal<typeof import('@cms-core')>()),
    VoiceInput: ({ value, onChange, placeholder }: {
        value?: string; onChange?: (event: unknown) => void; placeholder?: string;
    }) => (
        <input value={value ?? ''} placeholder={placeholder} onChange={onChange} />
    ),
    VoiceTextArea: ({ value, onChange, placeholder }: {
        value?: string; onChange?: (event: unknown) => void; placeholder?: string;
    }) => (
        <textarea value={value ?? ''} placeholder={placeholder} onChange={onChange} />
    ),
}));

import { TemplateCollectionEditor } from './TemplateCollectionEditor';
import { TemplateCollectionV0 } from '@cms-kit/template-lang';

const TEMPLATE: TemplateCollectionV0 = {
    name: 'Greeting',
    index: '',
    rootTemplate: { id: 'root', textTemplate: 'Hello!' },
    subTemplates: [],
};

const show = (onChange: (next: TemplateCollectionV0) => void) => render(
    <TemplateCollectionEditor template={TEMPLATE} onChange={onChange} />,
);

describe('TemplateCollectionEditor', () => {
    it('hands every edit over as the collection it makes', () => {
        const onChange = vi.fn();
        show(onChange);

        fireEvent.change(screen.getAllByPlaceholderText('Template Body')[0], {
            target: { value: 'Hello ${who:text}!' },
        });

        expect(onChange).toHaveBeenCalledWith({
            ...TEMPLATE,
            rootTemplate: { id: 'root', textTemplate: 'Hello ${who:text}!' },
        });
    });

    it('adds a sub-template under the Root', () => {
        const onChange = vi.fn();
        show(onChange);

        fireEvent.click(screen.getByRole('button', { name: 'Add template' }));

        expect(onChange).toHaveBeenCalledWith({
            ...TEMPLATE,
            subTemplates: [{ id: '', textTemplate: '' }],
        });
    });

    it('draws the sub-templates it is given, each deletable', () => {
        const onChange = vi.fn();
        const Held: React.FC = () => {
            const [template, setTemplate] = useState<TemplateCollectionV0>({
                ...TEMPLATE,
                subTemplates: [{ id: 'bye', textTemplate: 'Goodbye!' }],
            });
            return <TemplateCollectionEditor template={template} onChange={next => {
                setTemplate(next);
                onChange(next);
            }} />;
        };
        render(<Held />);

        expect(screen.getAllByPlaceholderText('Template Body')).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(onChange).toHaveBeenCalledWith(TEMPLATE);
    });
});
