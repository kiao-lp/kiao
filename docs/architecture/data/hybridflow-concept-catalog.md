---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Hybridflow — Catalogue des concepts

## Nœuds, cartes et tâches

- **`flow node`** (*nœud de flux*) désigne un élément d’un tableau Hybridflow. Il peut appartenir
  à un workflow et représente une tâche, une étape de contrôle ou une information affichée.
  Ce terme s’emploie pour son identité, ses données, ses liens et son cycle de vie, y compris
  dans l’interface quand une action crée, exécute ou archive cet élément.
- **`card`** (*carte*) désigne la représentation graphique d’un nœud de flux. Ce terme s’emploie
  pour ce qui est dessiné sur le tableau, quelle que soit sa forme, et pour les gestes sur
  cette représentation, comme sa sélection, son déplacement sur le canevas ou son
  redimensionnement.
- **`task`** (*tâche*) désigne le travail confié à un agent ou à une personne, avec ses
  instructions et ses critères de réussite. Dans le modèle Hybridflow, seuls les nœuds de
  type AI ou Human portent une tâche.

[Nommage du modèle (ADR 00042)](../../solution-design/decisions/00042-flow-nodes-not-tasks.md) ·
[Distinction entre le modèle et sa représentation (ADR 00072)](../../solution-design/decisions/00072-flow-node-and-card.md)

## Ressources agentiques et exécution

- Une **ressource agentique** (*agentic resource*) est un artefact réutilisable qui contribue
  au travail délégué. Les agents, les skills et les définitions de serveurs MCP en sont des
  exemples.
- Un **agent** est une ressource agentique dédiée à un ensemble cohérent de tâches. Sa définition
  peut fournir des instructions permanentes et assembler d’autres ressources agentiques, comme
  des skills et des définitions de serveurs MCP, en les déclarant comme dépendances. Elle peut
  s’appliquer à plusieurs harnesses. Dans Hybridflow, elle a une identité stable et peut
  préciser des préférences de modèle, d’effort et de profil d’exécution. Une publication fixe
  une révision de la définition et de ses dépendances. Une tâche IA référence l’agent. Les
  conversations libres et les conversations de tâche conservent la publication utilisée. Une
  conversation en mode brouillon conserve un instantané des sources et des dépendances résolues.
- Un **harness** est l’outillage qui exécute les tours et expose ses propres options de modèle
  et modes d’autorisation. Claude Code, Codex, Muse et Pi sont des harnesses. Un harness gère
  ses sessions natives et peut exposer des fonctions de connexion ou de suivi des quotas.
  Le runner Hybridflow coordonne les tours et transmet au harness choisi les instructions et
  les ressources de l’agent. Les profils locaux et les identifiants relèvent de l’installation
  qui exécute le tour.

[Choix de terminologie (ADR 00073)](../../solution-design/decisions/00073-agent-and-harness-vocabulary.md) ·
[Cycle de vie des ressources agentiques](agentic-resources.md)

## Dossier de travail

Le champ `settings.folder` d’une tâche porte un **DCMS link** vers son dossier de travail
ou une expression évaluée à l’exécution, comme `{{workflowFolder}}`. `/` désigne le
DCMS root. Une valeur vide laisse le champ indéfini.
L’enregistrement d’une conversation ou d’un tour utilise le chemin normalisé du dossier
de travail relatif au DCMS root, avec une chaîne vide pour la racine.
[Catalogue DCMS](dcms-concept-catalog.md)
