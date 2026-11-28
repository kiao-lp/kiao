---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# DCMS: Catalogue des concepts

- document: artefact informationnel identifiable et persisté, créé, reçu, assemblé ou manipulé.

- contenu: une unité informationnelle identifiable et structurée, destinée à être publiée ou diffusée.

Le document est le concept central de DCMS. Il peut prendre la forme d'une note, d'un fichier
de code source, d'un modèle ou d'un média. Une base de connaissances repose elle aussi sur des
documents et leurs relations.

La présentation des usages peut énumérer les bases de documents, de code source ou de
connaissances. Dans les descriptions opérationnelles et techniques, « document » désigne
l'ensemble de ces artefacts. « Contenu » précise une destination de publication ou de diffusion.

## DCMS root

Le **DCMS root** est le répertoire configuré que le worker expose comme racine du dépôt
documentaire. Les chemins de l’API de fichiers sont exprimés par rapport à ce répertoire.
Les outils qui accèdent directement au système de fichiers du worker utilisent le chemin
absolu du DCMS root sur cette machine.

Le répertoire d’état opérationnel a son propre emplacement, par défaut sous le DCMS root.
Un dépôt Git a sa propre racine. Le dossier de travail Hybridflow indique où commence une
conversation ou un tour. Ces répertoires peuvent coïncider avec le DCMS root.

[Choix de terminologie (ADR 00074)](../../solution-design/decisions/00074-dcms-root.md)

## DCMS link

Un **DCMS link** est une référence écrite à un document ou à un dossier, qui commence par
un seul `/` et se résout depuis le DCMS root. Par exemple, `/docs/guide.md` désigne un document,
`/docs` un dossier et `/` le DCMS root lui-même.

Un DCMS link peut servir de destination Markdown ou de valeur dans un champ structuré,
comme `members` ou `contents[].path` dans une unité et `settings.folder` dans Hybridflow.
Les schémas `unit::` et `template::` peuvent porter un DCMS link après leur préfixe.
La forme du DCMS link est indépendante de l’origine web et du point de montage de Dashboard.
Dans une destination Markdown ordinaire, un espace s’écrit `%20`. Un fragment peut cibler
un titre ou un passage. Les champs structurés suivent la convention de leur format.

| Forme | Exemple | Base de résolution |
| --- | --- | --- |
| DCMS link | `/docs/guide.md` | DCMS root |
| Lien Markdown relatif au document | `docs/guide.md` | Dossier du document qui contient le lien |
| Chemin d’API de fichiers (`FileDto.path`) | `docs/guide.md` | DCMS root |
| URL Dashboard | `https://example.com/dashboard/docs/guide.md` | Origine et point de montage indiqués dans l’URL |
| Chemin absolu sur la machine du worker | `/srv/kiao/docs/guide.md` | Racine du système de fichiers du worker |

[Choix de terminologie (ADR 00075)](../../solution-design/decisions/00075-dcms-link.md)
