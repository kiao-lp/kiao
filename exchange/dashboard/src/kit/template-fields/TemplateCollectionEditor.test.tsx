import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render as renderEditor, screen, fireEvent } from '@testing-library/react';
import { VoiceInputProvider } from '@kiao-dashboard-core';

import { TemplateCollectionEditor } from './TemplateCollectionEditor';
import { TemplateCollectionV0 } from '@kiao-dashboard-kit/template-lang';

const TEMPLATE: TemplateCollectionV0 = {
    name: 'Greeting',
    rootTemplate: { id: 'root', textTemplate: 'Hello!' },
    subTemplates: [],
};

const render = (editor: React.ReactElement) => renderEditor(editor, { wrapper: VoiceInputProvider });

const show = (onChange: (next: TemplateCollectionV0) => void) => render(
    <TemplateCollectionEditor template={TEMPLATE} onChange={onChange} />,
);

describe('TemplateCollectionEditor', () => {
    it('hands every edit over as the collection it makes', () => {
        const onChange = vi.fn();
        show(onChange);

        expect(screen.getByLabelText('Name')).toHaveValue('Greeting');
        fireEvent.change(screen.getByLabelText('Root Template'), {
            target: { value: 'Hello ${who:text}!' },
        });

        expect(onChange).toHaveBeenCalledWith({
            ...TEMPLATE,
            rootTemplate: { id: 'root', textTemplate: 'Hello ${who:text}!' },
        });
    });

    it('allows a file template to be named even when it starts unnamed', () => {
        const onChange = vi.fn();
        render(<TemplateCollectionEditor template={{ ...TEMPLATE, name: undefined }} onChange={onChange} />);

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Welcome' } });
        expect(onChange).toHaveBeenCalledWith({ ...TEMPLATE, name: 'Welcome' });
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
        expect(screen.getAllByRole('button', { name: 'Syntax Help' })).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(onChange).toHaveBeenCalledWith(TEMPLATE);
    });

    it('moves only the sub-templates and keeps keyboard focus on the moved grip', () => {
        const first = { id: '', textTemplate: 'First' };
        const second = { id: '', textTemplate: 'Second' };
        const third = { id: 'bye', textTemplate: 'Third' };
        const Held = () => {
            const [template, setTemplate] = useState({ ...TEMPLATE, subTemplates: [first, second, third] });
            return <TemplateCollectionEditor template={template} onChange={setTemplate} />;
        };
        render(<Held />);

        const grip = screen.getByRole('button', { name: 'Reorder sub template 1' });
        grip.focus();
        fireEvent.keyDown(grip, { key: 'ArrowDown' });
        const movedGrip = screen.getByRole('button', { name: 'Reorder sub template 2' });
        expect(movedGrip).toHaveFocus();
        fireEvent.keyDown(movedGrip, { key: 'End' });

        expect(screen.getByRole('button', { name: 'Reorder sub template 3' })).toHaveFocus();
        expect(screen.getAllByPlaceholderText('Template Body').map(input => (input as HTMLTextAreaElement).value))
            .toEqual(['Hello!', 'Second', 'Third', 'First']);
    });
});
