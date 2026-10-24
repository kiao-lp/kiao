/**
 * Formats spoken text by replacing spoken punctuation words with actual punctuation marks.
 * Applies typographic rules for spacing and capitalization.
 * Supports French and English.
 */

interface PunctuationRule {
    pattern: RegExp;
    replacement: string;
    /** Whether the next character should be capitalized */
    capitalizeNext: boolean;
}

// French punctuation rules with French spacing (space before : ; ? !)
const FRENCH_PUNCTUATION_RULES: PunctuationRule[] = [
    // Order matters: longer phrases first to avoid partial matches
    { pattern: /\bpoint d'exclamation\b/gi, replacement: ' !', capitalizeNext: true },
    { pattern: /\bpoint d'interrogation\b/gi, replacement: ' ?', capitalizeNext: true },
    { pattern: /\bouvr(?:ez|er) la parenth[eè]se\b/gi, replacement: ' (', capitalizeNext: false },
    { pattern: /\bferm(?:ez|er) la parenth[eè]se\b/gi, replacement: ')', capitalizeNext: false },
    { pattern: /\bouvr(?:ez|er) les guillemets\b/gi, replacement: '«', capitalizeNext: false },
    { pattern: /\bferm(?:ez|er) les guillemets\b/gi, replacement: '»', capitalizeNext: false },
    { pattern: /\bpoint-virgule\b/gi, replacement: ' ;', capitalizeNext: false },
    { pattern: /\bdeux points\b/gi, replacement: ' :', capitalizeNext: false },
    { pattern: /\bnouvelle ligne\b/gi, replacement: '\n', capitalizeNext: true },
    { pattern: /(?:^|\s)[àa] la ligne\b/gi, replacement: '\n', capitalizeNext: true },
    { pattern: /\bvirgule\b/gi, replacement: ',', capitalizeNext: false },
    { pattern: /\bpoint\b/gi, replacement: '.', capitalizeNext: true },
];

// English punctuation rules (no space before punctuation)
const ENGLISH_PUNCTUATION_RULES: PunctuationRule[] = [
    // Order matters: longer phrases first to avoid partial matches
    { pattern: /\bexclamation (?:point|mark)\b/gi, replacement: '!', capitalizeNext: true },
    { pattern: /\bquestion mark\b/gi, replacement: '?', capitalizeNext: true },
    { pattern: /\bopen(?:ing)? parenth[ae]sis\b/gi, replacement: ' (', capitalizeNext: false },
    { pattern: /\bclos(?:e|ing) parenth[ae]sis\b/gi, replacement: ')', capitalizeNext: false },
    { pattern: /\bopen(?:ing)? quotes?\b/gi, replacement: '“', capitalizeNext: false },
    { pattern: /\bclos(?:e|ing) quotes?\b/gi, replacement: '”', capitalizeNext: false },
    { pattern: /\bopen(?:ing)? bracket\b/gi, replacement: ' [', capitalizeNext: false },
    { pattern: /\bclos(?:e|ing) bracket\b/gi, replacement: ']', capitalizeNext: false },
    { pattern: /\bsemicolon\b/gi, replacement: ';', capitalizeNext: false },
    { pattern: /\bcolon\b/gi, replacement: ':', capitalizeNext: false },
    { pattern: /\bnew line\b/gi, replacement: '\n', capitalizeNext: true },
    { pattern: /\bnewline\b/gi, replacement: '\n', capitalizeNext: true },
    { pattern: /\bcomma\b/gi, replacement: ',', capitalizeNext: false },
    { pattern: /\bperiod\b/gi, replacement: '.', capitalizeNext: true },
    { pattern: /\bfull stop\b/gi, replacement: '.', capitalizeNext: true },
];

type Language = 'fr' | 'en';

/**
 * Formats spoken text by converting spoken punctuation words to actual
 * punctuation marks with proper typographic spacing and capitalization.
 * 
 * @param text - The raw transcript text with spoken punctuation
 * @param language - Language code ('fr' for French, 'en' for English). Defaults to 'fr'.
 * @returns The formatted text with proper punctuation
 * 
 * @example
 * formatSpokenText("Bonjour virgule comment ça va point d'interrogation", 'fr')
 * // Returns: "Bonjour, comment ça va ?"
 * 
 * @example
 * formatSpokenText("Hello comma how are you question mark", 'en')
 * // Returns: "Hello, how are you?"
 */
export function formatSpokenText(text: string, language: Language = 'fr'): string {
    if (!text) return text;

    const rules = language === 'en' ? ENGLISH_PUNCTUATION_RULES : FRENCH_PUNCTUATION_RULES;
    const isFrench = language === 'fr';

    // First clean up multiple spaces
    let result = text.replace(/ {2,}/g, ' ');

    // Track positions where we need to capitalize (will be applied after all replacements)
    const capitalizeMarker = '\u0000CAP\u0000';

    // Apply each punctuation rule
    for (const rule of rules) {
        result = result.replace(rule.pattern, () => {
            let replacement = rule.replacement;

            // Add capitalize marker if needed
            if (rule.capitalizeNext) {
                replacement += capitalizeMarker;
            }

            return replacement;
        });
    }

    // Remove space before punctuation that shouldn't have it
    if (isFrench) {
        // French: space before : ; ? ! is kept, remove before , . ) » \n
        result = result.replace(/ +([,.)\n»])/g, '$1');
    } else {
        // English: no space before any closing punctuation
        result = result.replace(/ +([,.:;!?)\]”\n])/g, '$1');
    }

    // Remove space after opening delimiters
    if (isFrench) {
        result = result.replace(/([«(]) +/g, '$1');
        // Handle French guillemets spacing: « text » (space inside)
        result = result.replace(/«(\S)/g, '« $1');
        result = result.replace(/(\S)»/g, '$1 »');
    } else {
        result = result.replace(/([([\u201c]) +/g, '$1');
    }

    // Remove capitalize marker that's directly after newline (keep the newline clean)
    result = result.replace(/\n\u0000CAP\u0000\s*/g, '\n' + capitalizeMarker);

    // Ensure space after punctuation (except at end of string, before newline, or before marker)
    if (isFrench) {
        result = result.replace(/([,.:;!?»)])([^\s\n\u0000])/g, '$1 $2');
    } else {
        result = result.replace(/([,.:;!?”\])])([^\s\n\u0000])/g, '$1 $2');
    }

    // Apply capitalization where marked
    while (result.includes(capitalizeMarker)) {
        const pos = result.indexOf(capitalizeMarker);
        const before = result.slice(0, pos);
        const after = result.slice(pos + capitalizeMarker.length);

        // Find the first letter after the marker and capitalize it
        const match = after.match(/^(\s*)([a-zA-Zà-ÿÀ-Ÿ])/);
        if (match) {
            const [, spaces, char] = match;
            result = before + spaces + char.toUpperCase() + after.slice(match[0].length);
        } else {
            // No letter found, just remove the marker
            result = before + after;
        }
    }

    // Capitalize first letter of the text
    result = result.replace(/^(\s*)([a-zA-Zà-ÿÀ-Ÿ])/, (_, spaces, char) => spaces + char.toUpperCase());

    // Final cleanup of any remaining multiple spaces
    result = result.replace(/ {2,}/g, ' ');

    // Trim leading/trailing spaces
    result = result.trim();

    return result;
}
