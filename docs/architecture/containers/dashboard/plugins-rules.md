# Dashboard plugins — règles d'architecture et implications constatées

Ce document dit **où placer un comportement nouveau** et **ce que chaque règle a
coûté à apprendre** : la checklist de décision, puis les précédents — incidents,
dégradations silencieuses et constats de lecture — qui la tiennent. Le contrat
et le runtime sont dans [plugins-runtime.md](./plugins-runtime.md), la sélection
et le build dans [plugins-assembly.md](./plugins-assembly.md).

## Les règles — checklist de décision

- **Un nouveau type de fichier est un plugin.** Qu'il soit livré à tout le monde
  ou vive en projet déposé est la décision d'audience, et elle ne change rien
  au contrat : même `index.tsx`, même catalogue, même configuration.
- **Un comportement app-wide est cms-core, pas un plugin** — le précédent Git :
  le diff applicatif, l'authentification, la création depuis les modèles de
  fichiers (`kiao-user-config/file-templates`), le folder browser. Tout store les
  offre, quel que soit l'assemblage.
- **Une opération qui a besoin du serveur est une server file action, pas un
  plugin** : une entrée de manifeste plus un endpoint, aucun code Dashboard ([vue
  d'ensemble](/docs/architecture/file-actions.md), [procédure](/.agents/skills/file-actions/SKILL.md)).
  Reste dans le plugin (entrée de menu contextuel) ce qui a besoin de ce qui est
  chargé dans l'onglet — le précédent de la version statique, dont les rendus
  sont corrects dans cet onglet et ne le seraient nulle part ailleurs.
- **Le code dont un second plugin a besoin part dans le kit** :
  `@cms-kit/<module>`, importé par les deux, avec sa propre entrée dans
  `tsconfig.paths.json` — il n'y a pas de wildcard `@cms-kit/*`, exprès. Un
  module utilisé par un seul plugin appartient **à ce plugin** (la pile
  d'édition d'archdia vit dans `archdia-edit`).
- **Une fonction dont un autre plugin a besoin devient une capability, et le
  consommateur doit marcher sans elle.** Les noms, leurs types et le
  comportement absent sont déclarés dans `@cms-kit/capabilities`, jamais dans
  l'un des plugins ; le vocabulaire propre du fournisseur en est banni
  (`chat.run`, pas `claude.run`). L'absence est le cas normal, pas une erreur.
- **Un panneau à côté du document d'un autre plugin est un side document, pas un
  wrapper** — il n'y a nulle part où mettre un troisième panneau sans
  réimplémenter le layout de l'hôte. `pathFor` dérive du chemin hôte pour que la
  paire voyage ensemble au renommage ; `create` ne tourne que pour un chemin que
  le store ne tient pas.
- **L'état qui doit survivre à la navigation va dans `providers`** ; l'état de
  vue par fichier (mode, onglet, zoom, scroll) dans la view state, jamais dans
  `useState` (perdu à la navigation) ni dans `localStorage` (non cléable par
  fichier). Une portée par clé, et on n'y persiste pas un mode dangereux à
  rouvrir.
- **Un candidat à la surface partagée doit justifier toute sa taille dans le
  shell** : ce qui est partagé est partagé entier, sans tree-shaking. Voir le
  précédent `@ant-design/icons` ci-dessous.
- **Les imports vont dans un sens : `plugins → kit → cms-core`.** Un plugin
  n'importe jamais un autre plugin ; il n'atteint jamais `src/` par un chemin
  (le build le refuse) ; il lit le framework sur `@cms-core` et le partagé sur
  `@cms-kit/<module>`, jamais dans un fichier sous `src/cms-core/` ou `src/kit/`.
- **Un nouveau type de fichier avec un plugin veut généralement un skill à côté** :
  nommé dans `pluginOf`, avec les tests qui refusent un skill sans plugin et un
  plugin abandonné par le catalogue.
- **Pas de bouton Save.** Un changement est une écriture au travers d'un writer
  debounce (1000 ms, la latence de la maison) ; le chargement initial n'est pas
  une édition ; le writer prend chemin et payload en arguments ; flush en
  sortant, flush avant de confier le fichier à un service ; Ctrl+S avale le
  dialogue du navigateur et flush. Le détail procédural est au skill.
- **Les suffixes revendiqués sont déclarés**, et `fallback: true` est interdit à
  tout nouveau plugin — seuls `code-edit` et `text-edit` le portent.
- **Les clés de `markdownRenderers` sont globalement uniques** : la fusion
  écrase en silence, donc l'unicité est une convention que rien ne vérifie.

## Les implications constatées — ce que chaque règle a coûté

**Deux copies du shell, et la page des hooks cassés.** Un plugin du lot vit
*dans* `src/`, donc `../../ThemeContext` s'y résout aussi volontiers que
`./styles.css` — et ce qui revient n'est pas le module du shell : c'est une
**copie**, bundlée dans le plugin, tenant une seconde instance de l'état. Pour
un contexte React c'est fatal et entièrement silencieux : la copie du plugin lit
un contexte qu'aucun provider n'a rempli. C'est ce qui a mis `.graph.json` et
`.arch.md` à terre en production. D'où `contractOnly` au build, et `@/*`
délibérément absent des alias du contrat pour les projets déposés.

**`export *` depuis un paquet CommonJS ne réexporte rien.** Le shim venait avec
`default` et sans `useState` — et, pour le JSX runtime, sans rien du tout — donc
chaque plugin échouait sur `react` dans un assemblage de production pendant que
le serveur de dev, qui n'a pas d'import map, était parfaitement heureux. D'où le
réexport nom par nom lu sur le paquet lui-même, et la seconde moitié de
`checkImports` : chaque nom importé est vérifié contre le shim qui doit y répondre.

**`style2.css`, ou le CSS de chaque plugin parti en silence.** Le chargeur lie
`<id>/style.css` et rien d'autre, donc un second fichier CSS à côté est du CSS
livré et jamais chargé. D'où `alwaysAStylesheet` en `order: 'post'` — avant, et
c'est le vrai fichier que Vite renomme — et `checkStylesheets`, qui échoue le
build sur tout `.css` qui n'est pas `style.css`.

**La photo du CV rendue en texte alternatif.** Un plugin construit avec la seule
base de l'app demande `<base><file>`, un niveau trop haut ; ce chemin est sous
la SPA, le routeur y répond index.html avec un 200, et l'image servie en page
HTML se rend en texte alternatif — en silence, et seulement dans un assemblage
built. D'où la base `<base>plugins/<id>/` et `checkAssetUrls` : chaque asset émis
doit apparaître dans la sortie du plugin à sa vraie URL.

**Le shell offline qui ne charge rien.** Le precache du service worker est globbé
depuis `build/` à la fin du build du shell : des plugins construits après n'y
seraient simplement pas, et un rechargement offline se lèverait avec un shell qui
ne charge alors aucun plugin. D'où l'ordre — les plugins d'abord — que le
commentaire de `build-assembly.mjs` appelle forcé d'un côté ou de l'autre.

**La page qui ne s'installait sur aucun desktop.** Elle portait *deux*
`<link rel="manifest">`, un écrit à la main et un généré ; un navigateur lit le
premier et ignore le reste, et le premier déclarait une seule icône 64x64, sous
les 192px que Chromium veut. Android et iOS ne disaient rien — un raccourci
d'écran d'accueil n'a besoin d'aucun manifeste. D'où `checkInstallable` : un seul
manifeste nommé, ce qui rend installable dedans, chaque fichier pointé réellement
dans `build/`.

**Les projets déposés que deux builds avaient oubliés.** Les noms n'étaient que
dans le script de dev, donc le déploiement serveur et l'exécutable `kiao` installé livraient
chacun un assemblage sans eux, sans que rien le dise : un fichier déposé
s'ouvrait en code, et le panneau n'offrait aucune ligne dont remarquer l'absence.
D'où un script listant le répertoire des projets déposés : un site de build ne peut pas oublier
une liste qu'il ne tient pas, et l'image `kiao` est la seule à ne pas
l'appeler — c'est la copie remise à quelqu'un d'autre.

**Les renommages traversent trois lecteurs.** `claude` → `agent` → `chat`,
`movie-view` → `movie-edit`, `tasks-board` → `hybridflow-ui`, et
`claudeCodeEnabled` → `agentEnabled` → `chatEnabled` : un store nommant l'ancien nom nomme le
plugin qu'il a toujours voulu, donc il l'obtient — via `PLUGIN_RENAMES` et la
lecture de `normalizeConfig`, jamais une couche de compatibilité. Mais un id de
plugin renommé dans le catalogue a *trois* lecteurs : `PLUGIN_RENAMES`,
`pluginOf` côté skills, et la liste du store elle-même. La compatibilité est une
entrée, pas une couche : les vieilles variables d'environnement ne sont pas
lues, l'ancien préfixe d'API n'est pas servi.

**Le board et ses onze imports.** Les onze imports du board vers `claude`,
`tags` et `template-edit` sont devenus quatre capabilities et un module du kit —
et le board dégrade désormais de la même façon que la fonction soit éteinte ou
que le plugin n'ait jamais été assemblé. C'est le précédent qui a scellé la
règle : le code partagé part au kit, la fonction partagée voyage en capability.

**`isEnabled` ne couvre que les routes et les onglets.** Constat de lecture,
pas un bug : `App.tsx` ne filtre par `isEnabled` que les `appRoutes` et les
`toolBars` (plus le `isEnabled` par onglet). La résolution de fichiers, les
commandes de création, les `providers` et les `capabilities` d'un plugin chargé
restent en vie : `chatEnabled: false` cache les onglets mais laisse le socket
monté et les capabilities publiées. C'est pourquoi le consommateur combine les
deux lui-même (`useChatAvailable` : `chatEnabled && useChatRunAvailable()`).

**L'ordre de l'assemblage est l'ordre de l'utilisateur.** La bascule du panneau
écrit dans l'ordre du catalogue, pas dans celui des clics — et c'est cet ordre
qui tranche entre plusieurs éditeurs d'une capability « premier gagne » comme
l'ordre de proposition des onglets. La résolution de fichiers, elle, n'en dépend
jamais.

**`knownExtensions` est poolé, pas lu sur le prétendant.** `.arch.md` est
déclaré par `archdia-edit` et `.md` par `markdown-edit` : lire les extensions sur
le seul plugin qui revendique le fichier laisserait un `.arch.md` ne garder que
`.md` à son nom. D'où le pool trié plus-long-d'abord, insensible comme la
résolution à l'ordre d'enregistrement.

## Sources

- Les règles en procédure : le skill `dashboard-plugin`
  ([`.agents/skills/dashboard-plugin/SKILL.md`](/.agents/skills/dashboard-plugin/SKILL.md))
- Les précédents dans le code :
  [`pluginBuild.mjs`](/exchange/dashboard/vite-plugins/pluginBuild.mjs)
  (`contractOnly`, `alwaysAStylesheet`),
  [`build-assembly.mjs`](/exchange/dashboard/scripts/build-assembly.mjs)
  (les quatre checks),
  [`assembly.ts`](/exchange/dashboard/vite-plugins/assembly.ts) (les shims),
  [`assembly-shared.mjs`](/exchange/dashboard/vite-plugins/assembly-shared.mjs)
  (`SHARED_MODULES`),
  [`useChatAvailable.ts`](/exchange/dashboard/src/plugins/hybridflow-ui/useChatAvailable.ts)
- Les décisions :
  [decision records](/docs/architecture/decisions/README.md) —
  2026-07-16 (manifeste, file actions), 2026-08-31 (assemblage, projets externes,
  capabilities), 2026-09-03 (`claude` → `agent`), 2026-09-15 (`tasks-board` →
  `hybridflow-ui`)
