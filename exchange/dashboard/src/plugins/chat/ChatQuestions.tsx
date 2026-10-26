import React, { useState } from 'react';
import { Button, Checkbox, Input, Radio } from 'antd';
import { MessageOutlined, SendOutlined } from '@ant-design/icons';
import type { Question, QuestionRequest } from './chatMessages';

/**
 * What one question has been answered with, before it is turned into the single string the tool
 * takes. The two halves are kept apart while the card is open because they are answered by
 * different controls: `chosen` are the options ticked, `other` is what was typed instead of — or,
 * on a multi-select, alongside — them.
 */
interface Draft {
    chosen: string[];
    other: string;
}

const emptyDraft = (): Draft => ({ chosen: [], other: '' });

/**
 * One question's answer as the tool reads it: the chosen labels and anything typed, comma-separated,
 * which is the form the CLI documents for a multi-select and the form it prints back to the model.
 * Empty means the question was not answered — and that is sent as such rather than as a blank
 * answer, because "the user did not answer" is true and "the user answered nothing" is not.
 */
const answerOf = (draft: Draft): string =>
    [...draft.chosen, draft.other.trim()].filter(Boolean).join(', ');

/**
 * One question, with its options and the free-text box every question has.
 *
 * The options are the model's suggestions and never a closed list — the CLI's own dialog always
 * offers "Other", and a question that arrived with no options at all is answered here by typing.
 * On a single-select the two controls are exclusive, because the answer is one value and having
 * both filled in would leave the card deciding which the user meant; on a multi-select the typed
 * text joins the ticked options, since the answer is a list either way.
 */
const QuestionFields: React.FC<{
    question: Question;
    draft: Draft;
    onChange: (draft: Draft) => void;
}> = ({ question, draft, onChange }) => {
    const multi = !!question.multiSelect;
    // The preview belongs to the option it illustrates, so it is shown for what is currently chosen
    // rather than for all of them at once: a sidebar wide enough for four mock-ups side by side does
    // not exist, and stacking them is what makes the card unreadable.
    const previews = question.options.filter(o => o.preview && draft.chosen.includes(o.label));

    return (
        <div className="chat-question">
            {question.header && <span className="chat-question-header">{question.header}</span>}
            <div className="chat-question-text">{question.question}</div>
            {question.options.length > 0 && (multi ? (
                <Checkbox.Group
                    className="chat-question-options"
                    value={draft.chosen}
                    onChange={chosen => onChange({ ...draft, chosen: chosen as string[] })}
                >
                    {question.options.map(option => (
                        <Checkbox key={option.label} value={option.label}>
                            <span className="chat-question-label">{option.label}</span>
                            {option.description && (
                                <span className="chat-question-description">{option.description}</span>
                            )}
                        </Checkbox>
                    ))}
                </Checkbox.Group>
            ) : (
                <Radio.Group
                    className="chat-question-options"
                    value={draft.chosen[0] ?? ''}
                    // Picking an option clears what was typed: one of the two is the answer, and the
                    // one just clicked is the one the user means.
                    onChange={e => onChange({ chosen: [e.target.value], other: '' })}
                >
                    {question.options.map(option => (
                        <Radio key={option.label} value={option.label}>
                            <span className="chat-question-label">{option.label}</span>
                            {option.description && (
                                <span className="chat-question-description">{option.description}</span>
                            )}
                        </Radio>
                    ))}
                </Radio.Group>
            ))}
            {previews.map(option => (
                <pre key={option.label} className="chat-question-preview">{option.preview}</pre>
            ))}
            <Input.TextArea
                className="chat-question-other"
                value={draft.other}
                onChange={e => onChange(multi
                    ? { ...draft, other: e.target.value }
                    // The mirror of the radio above, so a single-select never holds two answers.
                    : { chosen: e.target.value ? [] : draft.chosen, other: e.target.value })}
                placeholder={question.options.length ? 'Or answer in your own words…' : 'Your answer…'}
                aria-label={`Answer in your own words: ${question.question}`}
                autoSize={{ minRows: 1, maxRows: 4 }}
            />
        </div>
    );
};

/**
 * One ask, with every question it carries answered on the one card and sent in one frame — which is
 * how the tool asks and how it reads the answer back.
 *
 * The turn is parked until this is answered, exactly as it is on a permission card, and unlike one
 * nothing here ever answers itself: `manualLive`'s countdown allows a call whose answer it can guess
 * and bypass mode allows every call unasked, but neither has an opinion about what the user thinks.
 * A question left alone waits, in every mode, for as long as it takes.
 */
const QuestionCard: React.FC<{
    request: QuestionRequest;
    onAnswer: (requestId: string, answers: string[]) => void;
}> = ({ request, onAnswer }) => {
    const [drafts, setDrafts] = useState<Draft[]>(() => request.questions.map(emptyDraft));
    // A card is taken off screen by `permission_resolved` coming back, not by being answered, so
    // without this the buttons stay live under a frame already on its way — and a second click would
    // send an answer the service drops, with nothing on screen saying so.
    const [sent, setSent] = useState(false);

    const answers = drafts.map(answerOf);
    const answered = answers.some(Boolean);

    const send = (values: string[]) => {
        setSent(true);
        onAnswer(request.requestId, values);
    };

    return (
        <div className="chat-question-card">
            <div className="chat-question-head">
                <MessageOutlined className="chat-question-icon" />
                <span className="chat-question-title">The turn is asking</span>
            </div>
            {request.questions.map((question, index) => (
                <QuestionFields
                    key={`${question.question}-${index}`}
                    question={question}
                    draft={drafts[index] ?? emptyDraft()}
                    onChange={draft => setDrafts(held => held.map((h, i) => (i === index ? draft : h)))}
                />
            ))}
            <div className="chat-question-actions">
                {/* Dismissing is answering: the empty set is sent, the tool tells the model the
                    question went unanswered, and the turn carries on. Leaving the card alone is the
                    other option, and it parks the turn rather than deciding anything. */}
                <Button size="small" disabled={sent} onClick={() => send(answers.map(() => ''))}>
                    Dismiss
                </Button>
                <Button
                    type="primary"
                    size="small"
                    icon={<SendOutlined />}
                    disabled={sent || !answered}
                    onClick={() => send(answers)}
                >
                    Answer
                </Button>
            </div>
        </div>
    );
};

/**
 * The questions the running turn is waiting on, one card each. Renders nothing when there are none,
 * which is most of the time and every turn of a model that never asks.
 */
export const ChatQuestions: React.FC<{
    requests: QuestionRequest[];
    onAnswer: (requestId: string, answers: string[]) => void;
}> = ({ requests, onAnswer }) => {
    if (requests.length === 0) return null;
    return (
        <div className="chat-questions">
            {requests.map(request => (
                <QuestionCard key={request.requestId} request={request} onAnswer={onAnswer} />
            ))}
        </div>
    );
};
