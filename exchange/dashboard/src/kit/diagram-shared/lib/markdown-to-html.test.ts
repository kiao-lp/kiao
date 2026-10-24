import { describe, it, expect } from 'vitest';
import { markdownToHtml } from './markdown-to-html';

describe('markdownToHtml', () => {

    it('returns empty string for empty input', () => {
        expect(markdownToHtml('')).toBe('');
    });

    it('wraps plain text in a paragraph', () => {
        expect(markdownToHtml('Hello world')).toBe('<p>Hello world</p>');
    });

    it('converts bold text', () => {
        expect(markdownToHtml('This is **bold** text')).toBe('<p>This is <strong>bold</strong> text</p>');
    });

    it('converts italic text', () => {
        expect(markdownToHtml('This is *italic* text')).toBe('<p>This is <em>italic</em> text</p>');
    });

    it('converts inline code', () => {
        expect(markdownToHtml('Use `npm install`')).toBe('<p>Use <code>npm install</code></p>');
    });

    it('converts links', () => {
        expect(markdownToHtml('Visit [Google](https://google.com)')).toBe(
            '<p>Visit <a href="https://google.com">Google</a></p>'
        );
    });

    it('converts headings', () => {
        expect(markdownToHtml('# Title\n\nBody')).toBe('<h1>Title</h1><p>Body</p>');
        expect(markdownToHtml('### Section')).toBe('<h3>Section</h3>');
    });

    it('converts unordered lists', () => {
        const md = '- Item 1\n- Item 2\n- Item 3';
        expect(markdownToHtml(md)).toBe('<ul><li>Item 1</li><li>Item 2</li><li>Item 3</li></ul>');
    });

    it('converts ordered lists', () => {
        const md = '1. First\n2. Second\n3. Third';
        expect(markdownToHtml(md)).toBe('<ol><li>First</li><li>Second</li><li>Third</li></ol>');
    });

    it('handles multiple paragraphs separated by blank lines', () => {
        const md = 'First paragraph\n\nSecond paragraph';
        expect(markdownToHtml(md)).toBe('<p>First paragraph</p><p>Second paragraph</p>');
    });

    it('converts line breaks within paragraphs', () => {
        const md = 'Line one\nLine two\nLine three';
        expect(markdownToHtml(md)).toBe('<p>Line one<br/>Line two<br/>Line three</p>');
    });

    it('handles mixed content', () => {
        const md = '# Title\n\nSome **bold** text with `code`.\n\n- Item A\n- Item B\n\nFinal paragraph.';
        const html = markdownToHtml(md);
        expect(html).toContain('<h1>Title</h1>');
        expect(html).toContain('<strong>bold</strong>');
        expect(html).toContain('<code>code</code>');
        expect(html).toContain('<ul>');
        expect(html).toContain('<li>Item A</li>');
        expect(html).toContain('<p>Final paragraph.</p>');
    });

    it('escapes HTML special characters', () => {
        expect(markdownToHtml('Use <div> tag & "quotes"')).toBe(
            '<p>Use &lt;div&gt; tag &amp; &quot;quotes&quot;</p>'
        );
    });

    it('handles bold inside inline code without formatting', () => {
        const html = markdownToHtml('Use `**not bold**` here');
        expect(html).toContain('<code>**not bold**</code>');
        expect(html).not.toContain('<strong>');
    });

    it('supports unordered lists with * marker', () => {
        const md = '* Item A\n* Item B';
        expect(markdownToHtml(md)).toBe('<ul><li>Item A</li><li>Item B</li></ul>');
    });

    it('converts GFM pipe tables', () => {
        const md = '| Name | Age |\n| --- | --- |\n| Alice | 30 |';
        expect(markdownToHtml(md)).toBe(
            '<table><thead><tr><th>Name</th><th>Age</th></tr></thead>' +
            '<tbody><tr><td>Alice</td><td>30</td></tr></tbody></table>'
        );
    });

    it('honours column alignment in tables', () => {
        const md = '| Left | Right |\n| :--- | ---: |\n| a | b |';
        expect(markdownToHtml(md)).toContain('<th style="text-align:left">Left</th>');
        expect(markdownToHtml(md)).toContain('<td style="text-align:right">b</td>');
    });

    it('leaves a lone pipe line a paragraph', () => {
        expect(markdownToHtml('A | B')).toBe('<p>A | B</p>');
    });
});
