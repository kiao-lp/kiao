import { MouseEvent, useCallback, useEffect, useState } from "react";
import "./UnicodeKeyboard.css";

interface UniChar {
    name: string;
    text: string;
    description?: string;
}

const characters: UniChar[] = [{
    name: "omega",
    text: "\u03C9",
    description: "Countable infinity in set theory."
}, {
    name: "sigma",
    text: "\u03C3",
    description: "Sequence of transactions in Petri nets."
}, {
    name: "gamma maj",
    text: "\u0393",
    description: "Sequence of transactions in Petri nets."
}, {
    name: "infinity",
    text: "\u221E",
    description: "Unbounded limit, larger than any number."
}, {
    name: "equivalent",
    text: "\u27FA"
}, {
    name: "implies",
    text: "\u21D2"
}, {
    name: "et",
    text: "\u2227"
}, {
    name: "or",
    text: "\u2228"
}, {
    name: "not",
    text: "\u00AC"
}, {
    name: "not equal",
    text: "\u2260"
}, {
    name: "for all",
    text: "\u2200"
}, {
    name: "there exist",
    text: "\u2203"
}, {
    name: "element of",
    text: "\u2208"
}, {
    name: "not an element of",
    text: "\u2209"
}];

// Salut ChatGPT. Quel est l'unicode et le nom anglais du symbole "appartient à" en math?

function insertAtCursorInFocusedInput(insertString: string) {
    const focusedElement = document.activeElement as HTMLInputElement | HTMLTextAreaElement;

    if (focusedElement && (focusedElement.tagName === 'INPUT' || focusedElement.tagName === 'TEXTAREA')) {
        const start = focusedElement.selectionStart;
        const end = focusedElement.selectionEnd;

        if (start !== null && end !== null) {
            const value = focusedElement.value;
            const textBefore = value.substring(0, start);
            const textAfter = value.substring(end, value.length);

            focusedElement.value = textBefore + insertString + textAfter;

            focusedElement.selectionStart = focusedElement.selectionEnd = start + insertString.length;
        }
    }
}

const stopEvent = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
};

const Key: React.FC<{ char: UniChar }> = ({ char }) => {


    const onClick = (event: MouseEvent) => {
        navigator.clipboard.writeText(char.text);
        insertAtCursorInFocusedInput(char.text);
        stopEvent(event);
    };

    return <div className="key" onMouseDown={stopEvent} onMouseUp={stopEvent} onClick={onClick}>{char.text}</div>
}

export const UnicodeKeyboard = () => {
    const [visibility, setVisibility] = useState(0);

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        if (event.ctrlKey && event.key === "u") {
            setVisibility(vis => (vis + 1) % 5);

            event.stopPropagation();
            event.preventDefault();
        }
    }, []);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    return <div className={`unicode-keyboard visibility-${visibility}`}>
        {characters.map(char => <Key key={char.text} char={char} />)}
    </div>;
}