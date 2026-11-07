---
status: DRAFT
role: PRIMARY_SOURCE
---

# Kiao — documents, workflows agentiques, et contenus

Kiao contient un **système de gestion de documents et de contenus** (DCMS) et un **moteur de workflow humain/IA**. Vous pouvez demander à l'IA de concevoir des workflows pour résoudre des tâches complexes, les inspecter, puis les exécuter.

Avec DCMS, gérez une base de documents, de code source et de connaissances : rassemblez vos sources, reliez vos notes et retrouvez l’information utile — code, design et architecture compris.

## Les agents travaillent avec vous

Du simple chat à la conception de workflows complexes, l'IA construit, propose, inspire, et vous conseille.

![La board Passation avant congés : cartes agent et humaines enchaînées, avec une attente planifiée](capture-tableau.png)

*La board Passation avant congés : les agents préparent et analysent en
parallèle, l'humain répond et valide, une attente planifiée ferme la
journée. Capture de l'application.*

## Vos fichiers restent vos fichiers

Pas de base opaque, pas d'export pour récupérer ce qui est à vous : kiao
édite un dossier tel quel, le versionne en git et le cherche en plein texte.
Ce que vous voyez dans le CMS est ce qui est sur le disque.

![L'éditeur markdown : source et aperçu côte à côte](capture-editeur.png)

*L'éditeur markdown — source et rendu côte à côte, navigation par onglets.
Ici une recette : texte, liste et tableau. Capture de l'application.*

## Un éditeur par format

Chaque type de fichier s'ouvre avec l'éditeur qui lui convient : markdown,
cartes mentales, graphes, diagrammes (PlantUML, archdia), PDF, ebooks,
images, vidéo, code… Le classeur ne change pas, seul l'établi s'adapte.

![Quatre éditeurs : Markdown avec diagramme Mermaid, schéma Archdia, carte mentale, matrice de comparaison](capture-formats.png)

*Un éditeur par format, quatre exemples : Markdown + Mermaid (diagramme de
séquence), Archdia (périmètre de confiance), carte mentale, matrice de
comparaison. Captures de l'application.*

## Télécharger et démarrer Kiao

Avec Docker installé et démarré (Docker Desktop sous Windows), lancez Kiao
sur le dossier de votre choix. Remplacez `kiao-documents` par ce dossier.

**Windows — PowerShell :**

```powershell
New-Item -ItemType Directory -Force -Path "$HOME\kiao-documents" | Out-Null
docker pull ghcr.io/kiao-lp/kiao:latest

docker run -d --name kiao `
  -p 127.0.0.1:48302:80 `
  -v "${HOME}\kiao-documents:/data" `
  -v kiao-dev:/opt/kiao/dev `
  -v kiao-postgres:/var/lib/postgresql/data `
  ghcr.io/kiao-lp/kiao:latest
```

**Linux — Bash :**

```bash
mkdir -p "$HOME/kiao-documents"
docker pull ghcr.io/kiao-lp/kiao:latest

docker run -d --name kiao \
  -p 127.0.0.1:48302:80 \
  -v "$HOME/kiao-documents:/data" \
  -v kiao-dev:/opt/kiao/dev \
  -v kiao-postgres:/var/lib/postgresql/data \
  ghcr.io/kiao-lp/kiao:latest
```

Ouvrez <http://localhost:48302/dashboard/> : Kiao est prêt.

[Guide Docker](../user-manual/deep-dive/kiao-docker.md).

---

*kiao — la distribution publique : gestion documentaire (DCMS) et workflows
humain-agent (hybridflow).*
