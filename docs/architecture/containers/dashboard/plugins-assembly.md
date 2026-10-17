# Dashboard plugins — sélection, build et livraison

Ce document dit comment l'ensemble des plugins est **choisi**, **compilé** et
**livré** : le catalogue, la surface partagée, le build des plugins puis du
shell, les vérifications qui tiennent lieu de tests du built, le serveur de dev
et les projets hors lot. Ce que Dashboard fait des plugins une fois chargés est
dans [plugins-runtime.md](./plugins-runtime.md) ; les règles de placement dans
[plugins-rules.md](./plugins-rules.md).

## L'idée en bref

Chaque plugin est compilé séparément, produit un artefact livrable
indépendamment, et ce dernier est chargé dynamiquement selon la configuration.
C'est la phrase dont tout le reste découle :

- **Un build par plugin, plus un pour le shell.** Chaque plugin donne son propre
  artefact — `build/plugins/<id>/`, un `index.js` et un `style.css` — et le
  shell est un build à part qui publie ce que les plugins n'embarquent pas
  (React, antd, `@cms-core`, les kits) au travers d'une import map. Un plugin
  n'est donc pas une seconde application : son bundle ne tient que son code et
  ce que lui seul veut.
- **L'ensemble est décidé deux fois, jamais dans la source** : au build, par
  `VITE_PLUGINS` (ce qui est *livré*) ; par store, dans `dashboard.json` (ce qui
  est *chargé*). D'où les deux corollaires : un assemblage sans un plugin ne le
  livre ni ne le télécharge, et un store sans un plugin l'ignore sans erreur.
- **Le build garantit ce que les tests ne couvrent pas.** Rien de ce qui tourne
  contre le serveur de dev n'exerce l'import map ni les bundles built — c'est
  donc le build lui-même qui vérifie : imports, feuille de style unique, URL
  des assets, installabilité.

## L'ensemble est décidé deux fois, et ni l'une ni l'autre dans la source

<!-- kiao:diagram
```mermaid
flowchart LR
    CAT[src/plugins/catalogue.json<br/>+ dropped projects] --&gt; V1{VITE_PLUGINS?}
    V1 --&gt;|unset| ALL[whole catalogue]
    V1 --&gt;|set| SUB[named ids]
    ALL &amp; SUB --&gt; BUILD[build/ — shell + plugins/&amp;lt;id&amp;gt;/]
    BUILD --&gt; V2{dashboard.json plugins?}
    V2 --&gt;|absent| LOAD_ALL[load all]
    V2 --&gt;|list| LOAD_SOME[load named, skip missing]
    V2 --&gt;|empty| LOAD_NONE[load none]
```
-->
![Mermaid diagram 1](plugins-assembly.assets/01-mermaid.svg)

- **Ce qui est livré** est fixé au build par `VITE_PLUGINS` (non positionné :
  tout le catalogue). `build/` tient le shell (`index.html` avec l'import map,
  `assets/`, `runtime/`) et un répertoire `plugins/<id>/` par plugin
  (`index.js`, `style.css`).
- **Ce qui est chargé** appartient au store, dans `.kiao-config/dashboard.json`.
  Un nom que le build ne porte pas n'est pas une erreur — un store ouvert par un
  assemblage plus petit — et le panneau de configuration le dit. Pas de liste du
  tout, c'est un store écrit avant que le choix n'existe : tout charge. Une liste
  vide est un choix, et il est honoré.

## Le catalogue — le lot, plus ce qu'on y a déposé

Le catalogue est [`catalogue.json`](/exchange/dashboard/src/plugins/catalogue.json) :
id, titre, et la phrase que le panneau de configuration montre. L'id est le nom
du dossier et le point d'entrée `src/plugins/<id>/index.tsx`, par convention et
sans exception ; la position dans le fichier ne décide rien.

[`readCatalogue`](/exchange/dashboard/vite-plugins/assembly-shared.mjs) y **ajoute**
les projets déposés : `VITE_PLUGIN_PATHS` nomme des répertoires de projets
plugins — chacun un `index.tsx` et un `package.json` déclarant un bloc
`kiaoPlugin` (`{ id, title, description }`) — dont les entrées rejoignent le
catalogue. Deux plugins revendiquant le même id, et c'est une erreur. De là,
rien ne les distingue : même build, même configuration de store, même ligne de
configuration. `VITE_PLUGINS` filtre les deux ensemble ; un id inconnu, et c'est
une erreur (`assembledPlugins`).

## La surface partagée — ce que le shell publie

**Un plugin ne porte pas son propre React.** Il casserait les hooks, perdrait le
thème antd et naviguerait hors du routeur. Le shell publie donc la surface
partagée ([`SHARED_MODULES`](/exchange/dashboard/vite-plugins/assembly-shared.mjs))
à des URL fixes sous le chemin de base, déclarée dans un
`<script type="importmap">` de `index.html`, et chaque plugin est construit avec
ces mêmes noms **externes** : son bundle demande `react` par son nom et le
navigateur lui remet la copie du shell. C'est le mécanisme du navigateur lui-même ;
rien à charger, rien à négocier au runtime.

Trois sortes y figurent, et rien d'autre :

- **Ce qui doit être une instance.** React et son JSX runtime (deux copies, des
  hooks cassés), antd (une seconde copie n'a pas de thème), le routeur, le
  contexte OIDC, les helpers de pointage, le client files (dont les erreurs se
  lisent au `instanceof`), CodeMirror (facets et registre de langages comme
  identités), mermaid (configuration globale et registre de diagrammes — plus
  cinq mégaoctets qu'il serait absurde d'avoir deux fois).
- **Ce que le shell porte déjà et qu'un plugin veut aussi.**
  `@codemirror/language-data` est importé par le kit *et* par un plugin : hors
  de la liste, il serait téléchargé deux fois, sans aucun gain.
- **Le framework lui-même.** `@cms-core` est tout ce qu'un plugin peut voir du
  shell, `@cms-kit/*` tout ce que les plugins partagent entre eux. Un plugin
  portant sa propre copie parlerait à une autre application.

Tout ce qui n'est *pas* sur la liste est bundlé dans le plugin qui l'importe, et
c'est le point : pdfjs voyage avec `pdf-view`, three.js avec
`three-d-model-view`, et un assemblage sans eux ne télécharge ni l'un ni l'autre.

**Ce qui est partagé est partagé entier.** Un module publié ne peut pas être
tree-shaken — l'import map doit pouvoir répondre de n'importe quel nom — donc
mettre quelque chose sur la liste coûte toute sa taille dans le shell. C'est
pourquoi `@ant-design/icons` n'y est **pas** (900 ko partagés contre quelques ko
bundlés par plugin : une icône est un composant, et deux copies d'un composant
sont deux copies d'un composant). C'est la règle à laquelle peser un candidat.

## Le build d'un plugin — un module, seul

[`pluginBuildConfig`](/exchange/dashboard/vite-plugins/pluginBuild.mjs) produit
`build/plugins/<id>/index.js` plus `style.css` — tout ce qu'un plugin est sur
disque. Ce qui en fait un plugin plutôt qu'une seconde application, c'est la
liste des externes : chaque nom de la surface partagée survit en import nu dans
la sortie, que l'import map résout vers la copie du shell.

- **`base` est le répertoire du plugin**, `<base>plugins/<id>/` : les fichiers
  émis y sont écrits un niveau sous le shell, et avec la seule base de l'app
  Vite écrirait des URL sous la SPA, où le routeur répond index.html à tout
  chemin non revendiqué — l'asset reviendrait en page HTML avec un 200 dessus.
  ([`checkAssetUrls`](#les-vérifications) tient cette règle.)
- **`cssCodeSplit: false`**, parce que le chargeur lie `<id>/style.css` et rien
  d'autre : un fichier par plugin, une règle plutôt qu'une consultation.
  `alwaysAStylesheet` émet un fichier vide pour un plugin qui ne style rien
  (en `order: 'post'`, après le CSS réel — avant, et le vrai fichier serait
  renommé `style2.css` et chargé par personne).
- **`preserveEntrySignatures: 'strict'`** : sans cela Rollup traite l'entrée
  comme celle d'une application — que personne n'importe — et en élimine les
  exports, laissant un bundle sans `plugin`.
- **`contractOnly`** refuse un plugin qui emballe sa propre copie du shell : un
  fichier de `src/` (hors `src/plugins/`) dans le bundle est une seconde
  instance de l'état que ce module tient — un contexte React sans provider, et
  le type de fichier qui n'ouvre plus en production, avec une pile pointant un
  hook pourtant bien là. C'est ce qui a mis `.graph.json` et `.arch.md` à terre
  en production. (`src/plugins/` n'est délibérément *pas* le shell : un plugin qui
  importe le module d'un autre n'en fait qu'une question de couplage, dont
  `@cms-kit/*` est la réponse.)

## Le build du shell — les shims et l'import map

Le côté Vite de l'assemblage est [`assembly.ts`](/exchange/dashboard/vite-plugins/assembly.ts) :

- **Un module de réexport par spécificateur partagé**, émis comme chunk d'entrée
  sous un nom fixe que l'import map peut pointer — et le code du shell atterrit
  dans le même graphe de chunks, ce qui fait de « la copie du shell » et « la
  copie du plugin » le même objet. Les fichiers ne sont pas hashés : l'import
  map les nomme, et les deux serveurs de front répondent déjà `no-store` sur
  tout le bundle.
- **Les modules CommonJS** (`react`, `react-dom`, `react-dom/client`,
  `react/jsx-runtime`) sont réexportés **nom par nom**, lus sur le paquet
  lui-même : `export * from 'react'` ne réexporte rien — Rollup voit un module
  CommonJS comme un défaut d'interop — et chaque plugin échouerait sur son
  premier import. Les modules ES à défaut (`mermaid`,
  `@uiw/react-codemirror`) le nomment explicitement, car `export *` ne porte
  jamais de défaut.
- **L'import map** est injectée dans `index.html` au build (et seulement là).
- **Deux modules virtuels** : `virtual:kiao-plugin-assembly` (`CATALOGUE`, et
  `SOURCES` sur le serveur de dev) et `virtual:kiao-runtime` (qui tire chaque
  module partagé dans le graphe du shell, pour que leurs feuilles de style
  soient liées depuis la page).
- **Les alias du contrat** (`@cms-core`, chaque `@cms-kit/*`, sans condition
  d'importateur — `vite-tsconfig-paths` applique les siens en regardant *qui*
  importe, donc rien pour une source hors `src/`) et **`server.fs.allow`**
  étendu aux répertoires déposés, le workspace root restant parce que le
  poser le remplace.

## L'ordre et les vérifications — le build tient lieu de tests du built

**Les plugins sont construits avant le shell**, parce que le precache du service
worker est globbé depuis `build/` à la fin du build du shell — après, et un
rechargement offline se lèverait avec un shell qui ne charge rien. Les builds de
plugins sont indépendants et tournent quelques-uns à la fois (4). Le shell est
typechecké d'abord, puis chaque projet déposé contre son propre tsconfig
(`tsc -p <dir>`) : l'assemblage est le seul endroit où les deux moitiés du
contrat existent à la fois, et ni Vite ni esbuild ne liraient les types.

[`build-assembly.mjs`](/exchange/dashboard/scripts/build-assembly.mjs) vérifie
ensuite ce que rien d'autre ne verrait avant un navigateur sur un vrai build :

| Vérification | Ce qu'elle attrape |
|---|---|
| `checkImports` | Chaque import nu survivant dans chaque bundle de plugin, contre l'import map — le spécificateur **et** chaque nom demandé. La seconde moitié n'est pas théorique : `export *` depuis un paquet CommonJS ne réexporte rien. |
| `checkStylesheets` | Tout `.css` qui n'est pas `style.css` : du CSS livré et jamais chargé — à quoi ressemble une collision de noms vue de l'extérieur. |
| `checkAssetUrls` | Chaque asset émis doit apparaître dans la sortie du plugin à sa vraie URL (`<base>plugins/<id>/<file>`) — sinon c'est une autre URL qui est demandée, et le build le dit. |
| `checkInstallable` | La page built s'installe, sur chaque plateforme : exactement un manifeste nommé, ce qui rend une app installable dedans (nom, `start_url`, `display`, icône ≥ 192px de purpose `any`), et chaque fichier pointé réellement dans `build/`. |

Le build publie enfin `plugins/catalogue.json` — ce que cet assemblage tient,
pour le panneau de configuration.

## Le serveur de dev diffère en exactement un endroit

Sur le serveur de dev (et sous vitest), un plugin est importé **depuis la
source** (`src/plugins/<id>/index.tsx`, ou `/@fs…` pour un projet déposé) : il n'y
a pas de bundles built à servir, et une édition doit être visible sans
reconstruire. L'import map n'est pas émise du tout — Vite a déjà résolu chaque
nom nu lui-même, elle serait inerte. Ce qui ne diffère **pas**, c'est le contrat
que ce fichier existe pour tenir : la configuration du store décide quels
plugins sont chargés, et elle le décide de la même façon des deux côtés.

Conséquence : **rien de ce qui tourne contre le serveur de dev n'exerce l'import
map** — vitest, la suite e2e, c'est-à-dire chaque test automatisé qui existe. Le
check du build en tient lieu ; un navigateur sur un vrai `npm run build` le
confirme.

## Les projets hors lot

`VITE_PLUGIN_PATHS` nomme des répertoires de projets plugins — chacun un
`index.tsx` plus un `package.json` déclarant un bloc `kiaoPlugin` — dont les
entrées sont *ajoutées* au catalogue. De là, rien ne les distingue : même build,
même configuration de store, même ligne de configuration. Ce qui diffère, c'est
le public : ils portent des contenus propres à un public donné (par exemple un
inventaire, un parcours de diplôme) et seules les builds de ce public les portent —
un assemblage partagé ne les porte pas.

Un projet hors `src/` ne résout aucun alias tsconfig et ne se voit rien servir
sans permission, donc l'assemblage répond par des alias Vite nus pour le contrat
(`@cms-core`, `@cms-kit/*` — `@/*` délibérément absent : atteindre `src/` est
l'attachement même que ceci existe pour empêcher), une entrée `server.fs.allow`
ajoutée, et son propre `node_modules` prêté en lien maintenu — ce que npm fait
pour une dépendance `file:`, et ce qui fait qu'un projet cloné n'importe où est
construit contre l'assemblage qui le construit réellement.

**L'assemblage possède la vérification.** Un projet déposé porte source, tests et
fixtures, et aucun moyen de les faire tourner : ses tests unitaires tournent
dans le `npm test` de l'assemblage (globs déposés, moins le `node_modules` prêté
— deux cents fichiers de tests d'autres gens — et moins `e2e/`, qui est à
Playwright), ses types dans le `npm run build` (`tsc -p <dir>`), son `e2e/` comme
projet Playwright avec fixtures semées. C'est le seul endroit où les deux moitiés
du contrat existent à la fois — donc un projet ne porte ni config vitest, ni
config playwright, ni `node_modules`, ni dépendance propre, et son `tsconfig.json`
étend celui de l'assemblage. **Ses tests restent avec lui** : unitaires beside la
source, spec e2e dans son propre `e2e/` avec fixtures dans `e2e/files/` — rien de
lui n'appartient à la suite livrée.

**Quels builds les portent est une liste que personne n'écrit deux fois.**
Un script imprime le répertoire des projets déposés
comme cette liste — un projet de plus est assemblé en étant mis dans le
dossier — et les builds du public concerné l'appellent.
Avant lui, la liste n'était que dans un script, et deux builds livraient chacun
un assemblage sans eux, sans que rien le dise : un fichier déposé s'ouvrait en
code, et le panneau n'offrait aucune ligne dont remarquer l'absence.

## Livraison — un répertoire, servi comme toujours

`npm run build` produit un répertoire, et chaque runtime qui sert
Dashboard — nginx dans l'image `kiao`, `bin/kiao-launcher/web.go`, un serveur de
production — le sert exactement comme toujours. Ce qui a changé, c'est ce
qu'il y a dedans :

```text
build/
  index.html              le shell, avec l'import map nommant les modules runtime
  assets/…                les chunks propres du shell
  runtime/react.js …      la surface partagée, à noms fixes pointés par l'import map
  plugins/<id>/           un répertoire par plugin : index.js, et style.css s'il y a lieu
  plugins/catalogue.json  ce que cet assemblage tient, pour le panneau de configuration
```

Côté harness e2e, le gabarit
(`e2e/data/files-template/.kiao-config/dashboard.json`) épingle l'assemblage
complet que la suite fait tourner — un plugin qui n'y est pas est un plugin sans
lequel la suite tourne — et `VITE_PLUGIN_PATHS` y nomme les projets déposés dont
les `e2e/` et fixtures sont semés.

## Sources

- L'assemblage :
  [`assembly-shared.mjs`](/exchange/dashboard/vite-plugins/assembly-shared.mjs),
  [`assembly.ts`](/exchange/dashboard/vite-plugins/assembly.ts),
  [`pluginBuild.mjs`](/exchange/dashboard/vite-plugins/pluginBuild.mjs),
  [`build-assembly.mjs`](/exchange/dashboard/scripts/build-assembly.mjs)
- Le catalogue : [`catalogue.json`](/exchange/dashboard/src/plugins/catalogue.json) ;
  les projets déposés arrivent par `VITE_PLUGIN_PATHS`
- Le chargement côté app :
  [`pluginAssembly.ts`](/exchange/dashboard/src/cms-core/core/assembly/pluginAssembly.ts)
- Les décisions :
  [decision records](/docs/architecture/decisions/README.md) —
  2026-08-31 (assemblage, projets externes)
