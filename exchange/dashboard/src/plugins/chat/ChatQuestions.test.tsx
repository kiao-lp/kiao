import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

import { ChatQuestions } from './ChatQuestions';
import type { QuestionRequest } from './chatMessages';

const indentQuestion: QuestionRequest = {
    requestId: 'req-q',
    toolName: 'AskUserQuestion',
    questions: [{
        question: 'Tabs or spaces?',
        header: 'Indent',
        options: [
            { label: 'Tabs', description: 'Tab characters', preview: 'if (x) {\n\tgo();\n}' },
            { label: 'Spaces', description: 'Space characters' },
        ],
    }],
};

const twoQuestions: QuestionRequest = {
    requestId: 'req-2',
    toolName: 'AskUserQuestion',
    questions: [
        indentQuestion.questions[0],
        {
            question: 'Which languages?',
            header: 'Languages',
            multiSelect: true,
            options: [{ label: 'Go' }, { label: 'TypeScript' }, { label: 'Java' }],
        },
    ],
};

const renderCards = (requests: QuestionRequest[]) => {
    const onAnswer = vi.fn();
    render(<ChatQuestions requests={requests} onAnswer={onAnswer} />);
    return onAnswer;
};

const typeInto = (label: string | RegExp, text: string) => {
    fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
};

describe('ChatQuestions', () => {
    it('renders nothing when nothing is being asked', () => {
        const { container } = render(<ChatQuestions requests={[]} onAnswer={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows the question, its header and every option with what it means', () => {
        renderCards([indentQuestion]);

        expect(screen.getByText('Tabs or spaces?')).toBeInTheDocument();
        expect(screen.getByText('Indent')).toBeInTheDocument();
        expect(screen.getByText('Tabs')).toBeInTheDocument();
        expect(screen.getByText('Space characters')).toBeInTheDocument();
    });

    it('sends the chosen option as the answer to its question', () => {
        const onAnswer = renderCards([indentQuestion]);

        fireEvent.click(screen.getByText('Tabs'));
        fireEvent.click(screen.getByText('Answer'));

        expect(onAnswer).toHaveBeenCalledWith('req-q', ['Tabs']);
    });

    it("shows the chosen option's preview, and only that one", () => {
        renderCards([indentQuestion]);

        expect(screen.queryByText(/go\(\);/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('Tabs'));
        expect(screen.getByText(/go\(\);/)).toBeInTheDocument();
    });

    it('joins a multi-select answer the way the tool reads it back', () => {
        const onAnswer = renderCards([twoQuestions]);

        fireEvent.click(screen.getByText('Spaces'));
        fireEvent.click(screen.getByText('Go'));
        fireEvent.click(screen.getByText('Java'));
        fireEvent.click(screen.getByText('Answer'));

        expect(onAnswer).toHaveBeenCalledWith('req-2', ['Spaces', 'Go, Java']);
    });

    it('takes an answer in the user\'s own words, which replaces the option picked', () => {
        const onAnswer = renderCards([indentQuestion]);

        fireEvent.click(screen.getByText('Tabs'));
        typeInto(/Tabs or spaces\?/, 'whatever the formatter does');
        fireEvent.click(screen.getByText('Answer'));

        expect(onAnswer).toHaveBeenCalledWith('req-q', ['whatever the formatter does']);
    });

    it('sends nothing but blanks when the card is dismissed, for both questions', () => {
        const onAnswer = renderCards([twoQuestions]);

        fireEvent.click(screen.getByText('Go'));
        fireEvent.click(screen.getByText('Dismiss'));

        expect(onAnswer).toHaveBeenCalledWith('req-2', ['', '']);
    });

    it('answers nothing until something has been chosen', () => {
        renderCards([indentQuestion]);

        expect(screen.getByText('Answer').closest('button')).toBeDisabled();
        fireEvent.click(screen.getByText('Spaces'));
        expect(screen.getByText('Answer').closest('button')).toBeEnabled();
    });

    it('sends one answer per card, and only once — the card goes when the service says so', () => {
        const onAnswer = renderCards([indentQuestion]);

        fireEvent.click(screen.getByText('Tabs'));
        fireEvent.click(screen.getByText('Answer'));
        fireEvent.click(screen.getByText('Answer'));

        expect(onAnswer).toHaveBeenCalledTimes(1);
    });

    it('answers a question that arrived with no options at all', () => {
        const onAnswer = renderCards([{
            requestId: 'req-open',
            toolName: 'AskUserQuestion',
            questions: [{ question: 'What should the folder be called?', options: [] }],
        }]);

        typeInto(/What should the folder be called\?/, 'grammar-basics');
        fireEvent.click(screen.getByText('Answer'));

        expect(onAnswer).toHaveBeenCalledWith('req-open', ['grammar-basics']);
    });
});
