# roisin-garde-fous

Mod Claude Code personnel :

- **Thèmes par univers** : Wavestone, Physio Ourcq, Perso (généalogie, site personnel), choisis d'après le dépôt touché ; `/univers wavestone|physio|perso` pour forcer.
- **Garde-fous git** : refuse l'ajout de tous les fichiers d'un coup (`add -A` ou `add .`), le push forcé, le push direct sur `main`/`master`/`prod`, `rm -rf` hors dossiers de build, la fusion de PR (sauf Physio, où `garde-prod.mjs` protège `prod`).
- **Confidentialité** : aucun nom réel du GEDCOM dans un commit, tag, PR ou ticket de `genealogie-roisin*` (lu en local, refus avec initiales seulement) ; pas de téléphone ni d'e-mail personnel dans les pages du CSE ; palette Physio figée, tokens « provisoire ».
- **Quota** : jauges contexte, 5 h et semaine avec écart au rythme régulier, alertes par seuil, mode économie (sous-agents sur Sonnet, consigne de sobriété), `/quota` par univers.
- **Interface** : bandeau au-dessus de la saisie (boutons Univers `u` et Blocages `b`), carte sous chaque action bloquée, ligne d'état.

Limite connue : les règles git lisent tout le texte d'une commande shell, y compris un texte écrit par heredoc ; un fichier qui cite une commande interdite s'écrit avec l'outil d'écriture.

## Installation

Dans une session Claude Code en terminal :

```
/plugin install roisin-garde-fous --marketplace oscar-roisin/claude-mods
```

Depuis un shell :

```
claude plugin install roisin-garde-fous --marketplace oscar-roisin/claude-mods
```

Dans l'application de bureau, où `/plugin` ne fonctionne pas : cliquer sur + à côté de la zone de saisie, puis Plugins, Add marketplace avec `oscar-roisin/claude-mods`, puis Add plugin.

Dépôt privé : la machine doit déjà avoir un accès git à github.com (clé SSH, ou `gh auth login` puis `gh auth setup-git`).

## Tests

```
claude plugin validate .
claude plugin test .
```
