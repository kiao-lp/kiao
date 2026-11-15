import { describe, it, expect } from 'vitest';
import { formatSpokenText } from './formatSpokenText';

describe('formatSpokenText', () => {
    describe('French (default)', () => {
        describe('basic punctuation replacement', () => {
            it('replaces "virgule" with a comma', () => {
                expect(formatSpokenText('bonjour virgule monde')).toBe('Bonjour, monde');
            });

            it('replaces "point" with a period', () => {
                expect(formatSpokenText('bonjour point')).toBe('Bonjour.');
            });

            it('replaces "point d\'exclamation" with an exclamation mark', () => {
                expect(formatSpokenText("c'est génial point d'exclamation")).toBe("C'est génial !");
            });

            it('replaces "point d\'interrogation" with a question mark', () => {
                expect(formatSpokenText("comment ça va point d'interrogation")).toBe("Comment ça va ?");
            });

            it('replaces "deux points" with a colon', () => {
                expect(formatSpokenText('voici deux points une liste')).toBe('Voici : une liste');
            });

            it('replaces "point-virgule" with a semicolon', () => {
                expect(formatSpokenText('premier point-virgule deuxième')).toBe('Premier ; deuxième');
            });
        });

        describe('parentheses and quotes', () => {
            it('handles parentheses', () => {
                expect(formatSpokenText('texte ouvrez la parenthèse note fermez la parenthèse suite'))
                    .toBe('Texte (note) suite');
            });

            it('handles French guillemets', () => {
                expect(formatSpokenText('il a dit ouvrez les guillemets bonjour fermez les guillemets'))
                    .toBe('Il a dit « bonjour »');
            });
        });

        describe('line breaks', () => {
            it('replaces "nouvelle ligne" with a newline', () => {
                expect(formatSpokenText('première ligne nouvelle ligne deuxième ligne'))
                    .toBe('Première ligne\nDeuxième ligne');
            });

            it('replaces "à la ligne" with a newline', () => {
                expect(formatSpokenText('première ligne à la ligne deuxième ligne'))
                    .toBe('Première ligne\nDeuxième ligne');
            });
        });

        describe('capitalization', () => {
            it('capitalizes the first letter of text', () => {
                expect(formatSpokenText('bonjour monde')).toBe('Bonjour monde');
            });

            it('capitalizes after a period', () => {
                expect(formatSpokenText('première phrase point deuxième phrase'))
                    .toBe('Première phrase. Deuxième phrase');
            });

            it('capitalizes after an exclamation mark', () => {
                expect(formatSpokenText("super point d'exclamation maintenant"))
                    .toBe("Super ! Maintenant");
            });

            it('capitalizes after a question mark', () => {
                expect(formatSpokenText("quoi point d'interrogation oui"))
                    .toBe("Quoi ? Oui");
            });

            it('does not capitalize after a comma', () => {
                expect(formatSpokenText('bonjour virgule comment ça va'))
                    .toBe('Bonjour, comment ça va');
            });

            it('does not capitalize after a colon', () => {
                expect(formatSpokenText('voici deux points les éléments'))
                    .toBe('Voici : les éléments');
            });
        });

        describe('spacing rules', () => {
            it('removes space before comma', () => {
                expect(formatSpokenText('mot virgule autre')).toBe('Mot, autre');
            });

            it('removes space before period', () => {
                expect(formatSpokenText('fin point')).toBe('Fin.');
            });

            it('keeps French spacing before ? and !', () => {
                expect(formatSpokenText("quoi point d'interrogation")).toBe("Quoi ?");
                expect(formatSpokenText("wow point d'exclamation")).toBe("Wow !");
            });

            it('keeps French spacing before : and ;', () => {
                expect(formatSpokenText('exemple deux points valeur')).toBe('Exemple : valeur');
                expect(formatSpokenText('a point-virgule b')).toBe('A ; b');
            });
        });

        describe('multiple punctuations', () => {
            it('handles multiple punctuations in a sentence', () => {
                expect(formatSpokenText("bonjour virgule comment ça va point d'interrogation bien point"))
                    .toBe("Bonjour, comment ça va ? Bien.");
            });

            it('handles complex sentences', () => {
                const input = "voici deux points un virgule deux virgule trois point c'est tout point d'exclamation";
                const expected = "Voici : un, deux, trois. C'est tout !";
                expect(formatSpokenText(input)).toBe(expected);
            });
        });

        describe('edge cases', () => {
            it('handles empty string', () => {
                expect(formatSpokenText('')).toBe('');
            });

            it('handles null-ish values', () => {
                expect(formatSpokenText(undefined as any)).toBe(undefined);
            });

            it('handles text without punctuation', () => {
                expect(formatSpokenText('bonjour monde')).toBe('Bonjour monde');
            });

            it('handles punctuation at the end', () => {
                expect(formatSpokenText('fin point')).toBe('Fin.');
            });

            it('handles punctuation at the start', () => {
                expect(formatSpokenText('point d\'exclamation wow')).toBe('! Wow');
            });

            it('cleans up multiple spaces', () => {
                expect(formatSpokenText('mot  virgule  autre')).toBe('Mot, autre');
            });

            it('is case insensitive for spoken words', () => {
                expect(formatSpokenText('test VIRGULE suite')).toBe('Test, suite');
                expect(formatSpokenText('test Point suite')).toBe('Test. Suite');
            });
        });
    });

    describe('English', () => {
        describe('basic punctuation replacement', () => {
            it('replaces "comma" with a comma', () => {
                expect(formatSpokenText('hello comma world', 'en')).toBe('Hello, world');
            });

            it('replaces "period" with a period', () => {
                expect(formatSpokenText('hello period', 'en')).toBe('Hello.');
            });

            it('replaces "full stop" with a period', () => {
                expect(formatSpokenText('hello full stop', 'en')).toBe('Hello.');
            });

            it('replaces "exclamation mark" with an exclamation mark', () => {
                expect(formatSpokenText('this is great exclamation mark', 'en')).toBe('This is great!');
            });

            it('replaces "exclamation point" with an exclamation mark', () => {
                expect(formatSpokenText('wow exclamation point', 'en')).toBe('Wow!');
            });

            it('replaces "question mark" with a question mark', () => {
                expect(formatSpokenText('how are you question mark', 'en')).toBe('How are you?');
            });

            it('replaces "colon" with a colon', () => {
                expect(formatSpokenText('here colon a list', 'en')).toBe('Here: a list');
            });

            it('replaces "semicolon" with a semicolon', () => {
                expect(formatSpokenText('first semicolon second', 'en')).toBe('First; second');
            });
        });

        describe('parentheses and quotes', () => {
            it('handles parentheses with "open/close"', () => {
                expect(formatSpokenText('text open parenthesis note close parenthesis more', 'en'))
                    .toBe('Text (note) more');
            });

            it('handles parentheses with "opening/closing"', () => {
                expect(formatSpokenText('text opening parenthesis note closing parenthesis more', 'en'))
                    .toBe('Text (note) more');
            });

            it('handles quotes', () => {
                expect(formatSpokenText('he said open quote hello close quote', 'en'))
                    .toBe('He said \u201chello\u201d');
            });

            it('handles brackets', () => {
                expect(formatSpokenText('see open bracket reference close bracket', 'en'))
                    .toBe('See [reference]');
            });
        });

        describe('line breaks', () => {
            it('replaces "new line" with a newline', () => {
                expect(formatSpokenText('first line new line second line', 'en'))
                    .toBe('First line\nSecond line');
            });

            it('replaces "newline" with a newline', () => {
                expect(formatSpokenText('first line newline second line', 'en'))
                    .toBe('First line\nSecond line');
            });
        });

        describe('capitalization', () => {
            it('capitalizes the first letter of text', () => {
                expect(formatSpokenText('hello world', 'en')).toBe('Hello world');
            });

            it('capitalizes after a period', () => {
                expect(formatSpokenText('first sentence period second sentence', 'en'))
                    .toBe('First sentence. Second sentence');
            });

            it('capitalizes after an exclamation mark', () => {
                expect(formatSpokenText('great exclamation mark now', 'en'))
                    .toBe('Great! Now');
            });

            it('capitalizes after a question mark', () => {
                expect(formatSpokenText('what question mark yes', 'en'))
                    .toBe('What? Yes');
            });

            it('does not capitalize after a comma', () => {
                expect(formatSpokenText('hello comma how are you', 'en'))
                    .toBe('Hello, how are you');
            });

            it('does not capitalize after a colon', () => {
                expect(formatSpokenText('here colon the items', 'en'))
                    .toBe('Here: the items');
            });
        });

        describe('spacing rules (no space before punctuation)', () => {
            it('removes space before comma', () => {
                expect(formatSpokenText('word comma other', 'en')).toBe('Word, other');
            });

            it('removes space before period', () => {
                expect(formatSpokenText('end period', 'en')).toBe('End.');
            });

            it('removes space before question mark (unlike French)', () => {
                expect(formatSpokenText('what question mark', 'en')).toBe('What?');
            });

            it('removes space before exclamation mark (unlike French)', () => {
                expect(formatSpokenText('wow exclamation mark', 'en')).toBe('Wow!');
            });

            it('removes space before colon (unlike French)', () => {
                expect(formatSpokenText('example colon value', 'en')).toBe('Example: value');
            });

            it('removes space before semicolon (unlike French)', () => {
                expect(formatSpokenText('a semicolon b', 'en')).toBe('A; b');
            });
        });

        describe('multiple punctuations', () => {
            it('handles multiple punctuations in a sentence', () => {
                expect(formatSpokenText('hello comma how are you question mark fine period', 'en'))
                    .toBe('Hello, how are you? Fine.');
            });

            it('handles complex sentences', () => {
                const input = 'here colon one comma two comma three period that is all exclamation mark';
                const expected = 'Here: one, two, three. That is all!';
                expect(formatSpokenText(input, 'en')).toBe(expected);
            });
        });

        describe('edge cases', () => {
            it('handles empty string', () => {
                expect(formatSpokenText('', 'en')).toBe('');
            });

            it('handles text without punctuation', () => {
                expect(formatSpokenText('hello world', 'en')).toBe('Hello world');
            });

            it('is case insensitive for spoken words', () => {
                expect(formatSpokenText('test COMMA next', 'en')).toBe('Test, next');
                expect(formatSpokenText('test Period next', 'en')).toBe('Test. Next');
            });
        });
    });
});
