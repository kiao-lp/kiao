import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { GateMatcher, parseCategory } from './matchers';
import { scanText } from './scan';

// Bundled catalogue checked in the browser RegExp engine; Go RE2 rejects some patterns.

const CATALOGUE = join(dirname(fileURLToPath(import.meta.url)),
    '../../../../../operation/worker/internal/files/importgate');

const load = (): GateMatcher[] => readdirSync(CATALOGUE)
    .filter(name => name.endsWith('.json'))
    .flatMap(name => parseCategory(name, JSON.parse(readFileSync(join(CATALOGUE, name), 'utf8'))));

// Fired rules, by label.
const labelsIn = (text: string, gate: GateMatcher[]): string[] =>
    scanText(text, gate).findings.map(finding => finding.matcher.label);

// All matching rules, overlaps included.
const hits = (text: string, gate: GateMatcher[]): string[] =>
    gate.filter(matcher => {
        matcher.regex.lastIndex = 0;
        const found = matcher.regex.test(text);
        matcher.regex.lastIndex = 0;
        return found;
    }).map(matcher => matcher.label);

let gate: GateMatcher[];
let warned: string[];

beforeAll(() => {
    warned = [];
    vi.spyOn(console, 'warn').mockImplementation((...args) => { warned.push(args.join(' ')); });
    gate = load();
});
afterAll(() => vi.restoreAllMocks());

describe('the bundled catalogue', () => {
    it('loads whole, with no rule dropped', () => {
        expect(warned).toEqual([]);
        expect(gate.length).toBeGreaterThan(50);
    });

    it('covers the categories the gate exists for', () => {
        const categories = [...new Set(gate.map(matcher => matcher.category))].sort();
        expect(categories).toEqual([
            'classified', 'financial', 'hr', 'identity',
            'infrastructure', 'legal', 'secrets', 'special-category',
        ]);
    });

    it('rates a leaked credential above a postcode', () => {
        const levels = new Map(gate.map(matcher => [`${matcher.category}/${matcher.label}`, matcher.criticality]));
        expect(levels.get('secrets/Private key block')).toBe('critical');
        expect(levels.get('identity/French postcode and town')).toBe('low');
    });

    const samples: [string, string, string][] = [
        ['secrets', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow==', 'Private key block'],
        ['secrets', 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'AWS secret access key'],
        ['secrets', 'export GITHUB_TOKEN=ghp_16C7e42F292c6912E7710c838347Ae178B4a', 'GitHub token'],
        ['secrets', 'postgres://kiao:s3cr3t@db.example.org:5432/prod', 'Credentials inside a URL'],
        ['secrets', 'mot de passe : Bonjour2026!', 'Password assigned a value'],
        ['classified', 'Ce document est classé CONFIDENTIEL DÉFENSE.', 'French defence classification'],
        ['classified', 'Marking: NATO SECRET — release restricted', 'NATO marking'],
        ['classified', 'Slide footer: INTERNAL USE ONLY', 'Corporate handling marking'],
        ['special-category', 'Le salarié est en arrêt de travail depuis mars.', 'Medical record or certificate'],
        ['special-category', 'Délégué syndical CFDT depuis 2019', 'Union membership'],
        ['special-category', 'Reconnaissance faciale sur les données biométriques du site', 'Biometric or genetic data'],
        ['identity', 'N° de sécurité sociale : 1 84 12 75 116 001 42', 'French social security number (NIR)'],
        ['identity', 'Écrire à claire.dubois@example.org avant vendredi', 'Email address'],
        ['identity', 'Téléphone : 06 12 34 56 78', 'French telephone number'],
        ['identity', '12 rue des Lilas, appartement 4', 'French postal address'],
        ['financial', 'IBAN FR7630006000011234567890189', 'IBAN'],
        ['financial', 'Carte 4970 1012 3456 7890 expire bientôt', 'Payment card number'],
        ['financial', 'SIRET : 552 100 554 00021', 'SIREN / SIRET'],
        ['hr', 'Bulletin de paie de septembre — net à payer 2 341,55 €', 'Payslip or payroll document'],
        ['hr', 'Entretien annuel : objectifs non atteints', 'Performance review'],
        ['hr', 'Une rupture conventionnelle a été proposée.', 'Discipline or dismissal'],
        ['hr', 'Signalement harcèlement moral reçu le 3 mars', 'Whistleblowing or investigation'],
        ['infrastructure', 'Le serveur répond sur 192.168.12.40', 'Private IPv4 address'],
        ['infrastructure', 'backup01.internal héberge la sauvegarde', 'Internal hostname'],
        ['infrastructure', 'Reste exposé : CVE-2024-3094 non corrigée', 'Known weakness'],
        ['legal', 'Communiqué sous NDA jusqu’au closing', 'Confidentiality undertaking'],
        ['legal', 'Attorney-client privileged — do not forward', 'Legal privilege'],
        ['legal', 'Brevet en cours de dépôt sur le procédé', 'Unfiled invention or trade secret'],
    ];

    it.each(samples)('%s catches %j', (category, text, label) => {
        const fired = hits(text, gate.filter(matcher => matcher.category === category));
        expect(fired, `nothing in ${category} matched`).toContain(label);
    });

    // Ordinary prose must not hit critical/high.
    it('leaves ordinary prose alone at the two levels that stop a reviewer', () => {
        const prose = [
            'La division cellulaire est le processus par lequel une cellule mère donne deux cellules filles.',
            'Cette unité comporte trois épisodes : la mitose, la méiose et leurs différences.',
            'Reprenez l’exercice 4 puis écoutez le podcast associé avant le prochain cours.',
            'The lesson closes with a short quiz of eight questions, corrected in the following episode.',
        ].join('\n');

        const alarming = scanText(prose, gate).findings
            .filter(finding => finding.matcher.criticality === 'critical' || finding.matcher.criticality === 'high');
        expect(alarming.map(finding => `${finding.matcher.label}: ${finding.text}`)).toEqual([]);
    });

    // One finding per span: the worse criticality wins.
    it('shows the credential rather than the word that introduced it', () => {
        expect(labelsIn('password: ghp_16C7e42F292c6912E7710c838347Ae178B4a', gate))
            .toEqual(['Password assigned a value']);
        expect(scanText('password: ghp_16C7e42F292c6912E7710c838347Ae178B4a', gate).findings[0].matcher.criticality)
            .toBe('critical');
    });
});
