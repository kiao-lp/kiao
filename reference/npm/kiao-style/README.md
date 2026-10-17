# 🎨 kiao-style

> Charte graphique unifiée pour les applications KIAO

Package CSS contenant le thème sombre KIAO avec design tokens (CSS variables) pour une utilisation universelle dans les applications KIAO.

## 📦 Installation

```bash
# En tant que dépendance locale
npm install file:../../reference/npm/kiao-style
```

## 🚀 Utilisation

### Dans une application React/Vite

```typescript
// main.tsx ou App.tsx
import { kiaoDarkTheme, kiaoLightTheme, kiaoSoberDarkTheme, kiaoSoberLightTheme } from 'kiao-style';
import 'kiao-style/kiao-dark.css';       // socle : règles de base + tokens du thème sombre
import 'kiao-style/kiao-light.css';      // les autres thèmes se chargent APRÈS le socle
import 'kiao-style/kiao-sober-dark.css';
import 'kiao-style/kiao-sober-light.css';
```

`kiao-dark.css` porte les règles de base (typographie, boutons, formulaires, tableaux) en plus
de ses propres tokens. Les trois autres feuilles ne sont que des jeux de tokens posés dessus :
elles doivent être chargées **après** lui, sinon le sombre l'emporte.

### Dans un fichier HTML

```html
<link rel="stylesheet" href="path/to/kiao-style/dist/kiao-dark.css">
<!-- ET / OU, toujours ensuite -->
<link rel="stylesheet" href="path/to/kiao-style/dist/kiao-light.css">
<link rel="stylesheet" href="path/to/kiao-style/dist/kiao-sober-dark.css">
<link rel="stylesheet" href="path/to/kiao-style/dist/kiao-sober-light.css">
```

### Dans Astro

```astro
---
import 'kiao-style/kiao-dark.css';
---
```

## 🎨 Design Tokens

Le thème KIAO utilise des CSS variables pour faciliter la personnalisation :

### Couleurs principales
- `--bg` : Fond principal (bleu nuit absolu)
- `--text` : Texte principal (blanc)
- `--accent` : Couleur d'accent (jaune lunaire)
- `--accent-bg` : Fond secondaire

### Couleurs secondaires
- `--border` : Couleur des bordures
- `--muted` : Texte secondaire
- `--text-disabled` : Texte désactivé

### Liens
- `--link` : Couleur des liens
- `--link-visited` : Liens visités

### Code
- `--code` : Couleur du texte code
- `--code-bg` : Fond des blocs code

### Couleurs principales
...

## 🌗 Les quatre thèmes

| `data-theme`   | Thème antd             | Mermaid                  | PlantUML                    | Luminosité |
| -------------- | ---------------------- | ------------------------ | --------------------------- | ---------- |
| `dark`         | `kiaoDarkTheme`        | `kiaoMermaidDark`        | `kiaoPlantUMLDark`          | `dark`     |
| `light`        | `kiaoLightTheme`       | `kiaoMermaidLight`       | `kiaoPlantUMLLight`         | `light`    |
| `sober-dark`   | `kiaoSoberDarkTheme`   | `kiaoMermaidSoberDark`   | `kiaoPlantUMLSoberDark`     | `dark`     |
| `sober-light`  | `kiaoSoberLightTheme`  | `kiaoMermaidSoberLight`  | `kiaoPlantUMLSoberLight`    | `light`    |

`dark` est appliqué par défaut, faute d'attribut.

Pour changer de thème dynamiquement :

```typescript
document.documentElement.setAttribute('data-theme', 'sober-light');
```

### Choisir un thème sans le nommer

Écrire `theme === 'dark' ? … : …` marche tant qu'il y a deux thèmes ; c'est la forme qui a
rendu l'ajout d'un troisième coûteux. Le registre répond à la place :

```typescript
import {
    KIAO_THEMES, DEFAULT_KIAO_THEME, asKiaoTheme, themeMode,
    kiaoAntTheme, kiaoMermaidTheme, kiaoPlantUMLTheme,
    type KiaoTheme, type ThemeMode,
} from 'kiao-style';

KIAO_THEMES                      // [{ id, label, mode }, …] — de quoi bâtir un menu
asKiaoTheme(stocké)              // un nom quelconque lu comme thème, défaut si inconnu
kiaoAntTheme(theme)              // le ThemeConfig antd
kiaoMermaidTheme(theme)          // les themeVariables mermaid
kiaoPlantUMLTheme(theme)         // le bloc skinparam
themeMode(theme)                 // 'dark' | 'light'
```

`themeMode` est l'autre moitié. Beaucoup de moteurs de rendu n'ont que deux palettes —
CodeMirror, archdia, les thèmes intégrés de mermaid — et on ne peut pas leur en donner une
troisième. Ils n'ont pas besoin du thème, mais de sa luminosité : un thème sobre est alors
dessiné à la sienne.

### Les thèmes sobres

`sober-light` et `sober-dark` sont volontairement sans originalité : gris neutres, un seul
accent bleu, hiérarchie de titres en une seule encre qui s'estompe rang après rang, rayons
courts (6 px sur les contrôles, 8 px sur les cartes), ombre à peine posée, h1 aligné à gauche
et police système. C'est l'apparence qu'une application de gestion est censée porter — celle
qu'on attend pour une démonstration, là où `dark` et `light` disent la charte KIAO.

Les tokens qu'ils définissent sont exactement ceux des deux autres thèmes : un composant
stylé par variables suit les quatre sans rien savoir d'eux. Ce que les tokens ne peuvent pas
atteindre — les rayons, l'ombre, la police, le h1 centré, écrits en dur dans les règles de
base de `kiao-dark.css` — est redit dans chaque feuille sobre, sous son propre sélecteur.

## 📚 Classes Utilitaires

### Layout
- `.fieldset` : Conteneur de formulaire stylisé
- `.inner-area` : Zone interne avec fond

### Espacement
- `.margin-top` : Marge supérieure de 16pt

### Texte
- `.bottom-note` : Note discrète centrée
- `.muted` : Texte secondaire discret

## 🏗️ Structure

```
kiao-style/
├── src/
│   ├── kiao-dark.css           # Règles de base + tokens du thème sombre
│   ├── kiao-light.css          # Tokens du thème clair
│   ├── kiao-sober-dark.css     # Tokens + formes du thème sobre sombre
│   ├── kiao-sober-light.css    # Tokens + formes du thème sobre clair
│   ├── style-tools.css         # Classes utilitaires
│   ├── kiao-themes.ts          # Le registre : la liste, et ce que chaque nom désigne
│   ├── kiao-ant-theme-*.ts     # ThemeConfig antd, un par thème
│   ├── kiao-mermaid-theme-*.ts # themeVariables mermaid, un par thème
│   └── kiao-plantuml-theme-*.ts # Blocs skinparam, un par thème
├── dist/                       # CSS compilé (minifié, autoprefixé) + JS/d.ts
├── package.json
├── postcss.config.js
└── README.md
```

## 🛠️ Développement

```bash
# Build une fois
npm run build

# Watch mode
npm run dev
```

## 📝 Philosophie

- **Thème sombre** optimisé pour la lecture prolongée
- **Thèmes sobres** pour les démonstrations, quand la charte doit s'effacer
- **Design tokens** via CSS variables pour flexibilité
- **Sans framework** : fonctionne avec HTML pur, React, Vue, Astro, etc.
- **Léger** : CSS pur minifié et autoprefixé
- **Maintenable** : Source unique partagée entre tous les projets KIAO

## 🔄 Migration depuis les fichiers locaux

Si vous migrez depuis un `kiao.css` local :

1. Ajoutez la dépendance dans `package.json`
2. Remplacez `import './kiao.css'` par `import 'kiao-style/kiao-dark.css'`
3. Supprimez votre fichier `kiao.css` local

## 📄 License

MIT
