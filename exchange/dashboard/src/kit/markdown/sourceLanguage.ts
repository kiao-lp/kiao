import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';

export const markdownSourceLanguage = markdown({ base: markdownLanguage, codeLanguages: languages });
