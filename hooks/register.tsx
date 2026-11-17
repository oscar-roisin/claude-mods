import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Autorisation, Contexte, Fenetre, Interception, Jauges, Univers } from '../types'
import { BLOQUANTS, THEMES } from './themes'

// ---------------------------------------------------------------------------
// Dépôts connus et univers
// ---------------------------------------------------------------------------

const DEPOTS: Record<string, Univers> = {
  'wavestone-cse-intranet': 'wavestone',
  'wavestone-cse-website': 'wavestone',
  'wavestone-rec-ai-case-studies': 'wavestone',
  'ai-corporate-agentification-demonstrator': 'wavestone',
  'physio-ourcq-website': 'physio',
  'genealogie-roisin-website': 'perso',
  'genealogie-roisin': 'perso',
  'oscar-roisin-public-website': 'perso',
}
// Le plus long d'abord : « genealogie-roisin-website » avant « genealogie-roisin ».
const NOMS = Object.keys(DEPOTS).sort((a, b) => b.length - a.length)

const LIBELLE: Record<Univers, string> = { wavestone: 'Wavestone', physio: 'Physio Ourcq', perso: 'Perso' }

const SENSIBILITE: Record<string, string> = {
  'genealogie-roisin-website': 'privé à vie : personnes vivantes',
  'genealogie-roisin': 'privé à vie : personnes vivantes',
  'wavestone-cse-intranet': 'pas de contact personnel, portraits sous consentement',
  'physio-ourcq-website': 'prod fusionnée par Oscar seul, palette figée',
}

function detecter(texte: string): Contexte {
  for (const nom of NOMS) {
    if (new RegExp(`(^|[/\\s'"])${nom}(?=$|[/\\s'"])`).test(texte)) {
      return { repo: nom, univers: DEPOTS[nom] as Univers }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// État partagé avec le bandeau
// ---------------------------------------------------------------------------

const contexte = atom({ plugin: 'roisin-garde-fous', key: 'contexte' } as const, null as Contexte, { shape: 'contexte-1' })
const interceptions = atom({ plugin: 'roisin-garde-fous', key: 'interceptions' } as const, [] as Interception[], {
  shape: 'interceptions-2',
})
const jauges = atom({ plugin: 'roisin-garde-fous', key: 'jauges' } as const, { economie: false } as Jauges, {
  shape: 'jauges-1',
})
const alertes = atom({ plugin: 'roisin-garde-fous', key: 'alertes' } as const, [] as string[], { shape: 'alertes-1' })
const dernierCout = atom({ plugin: 'roisin-garde-fous', key: 'dernierCout' } as const, -1)
const ouvert = atom({ plugin: 'roisin-garde-fous', key: 'ouvert' } as const, false)
/** Autorisation à usage unique de pousser vers une branche protégée, donnée par Oscar via /autoriser-push. */
const autorisation = atom({ plugin: 'roisin-garde-fous', key: 'autorisation' } as const, null as Autorisation, {
  shape: 'autorisation-1',
})
const AUTORISATION_MS = 10 * 60 * 1000

// ---------------------------------------------------------------------------
// Règles git (toutes les sessions)
// ---------------------------------------------------------------------------

const SEG = "[^;&|\\n]*"
const GIT_ADD_TOUT = new RegExp(`\\bgit\\b${SEG}\\badd\\b${SEG}(\\s-A\\b|\\s--all\\b|\\s\\.(?=\\s|$|;|&|\\|))`)
const GIT_FORCE = new RegExp(`\\bgit\\b${SEG}\\bpush\\b${SEG}(\\s-f\\b|\\s--force(?![-\\w])|\\s\\+\\S)`)
const GH_MERGE = new RegExp(`\\bgh\\s+pr\\s+merge\\b|\\bgh\\s+api\\b${SEG}/merges?\\b`)
const RM_RF = /\brm\s+(?:-[a-zA-Z]*(?:rf|fr)[a-zA-Z]*|-r\s+-f|-f\s+-r)\s+([^;&|\n]+)/
const RM_AUTORISE = /(^|\/)(node_modules|dist|build|coverage|\.astro|\.vite|\.turbo|out)\/?$|^\/tmp\//

function regleGit(commande: string, univers: Univers | undefined): string | null {
  if (GIT_ADD_TOUT.test(commande)) {
    return '« git add -A » ou « git add . » : nommer les fichiers un par un.'
  }
  if (GIT_FORCE.test(commande)) {
    return 'push forcé interdit sur une branche poussée.'
  }
  if (GH_MERGE.test(commande) && univers !== 'physio') {
    return 'fusion de PR réservée à Oscar.'
  }
  const rm = RM_RF.exec(commande)
  if (rm) {
    const cibles = (rm[1] ?? '').trim().split(/\s+/)
    if (cibles.some(c => !RM_AUTORISE.test(c.replace(/^["']|["']$/g, '')))) {
      return '« rm -rf » hors dossiers de build : supprimer à la main ou cibler précisément.'
    }
  }
  return null
}

/**
 * La commande sans le corps de ses heredocs : un texte écrit dans un fichier (README, message)
 * n'est pas une commande. La ligne d'ouverture et ce qui suit le délimiteur de fin restent lus.
 * Le contrôle des noms du GEDCOM, lui, lit la commande entière (un message de commit peut venir d'un heredoc).
 */
function sansHeredocs(commande: string): string {
  return commande.replace(
    /(<<-?[ \t]*(['"]?)([A-Za-z_][\w-]*)\2)([^\n]*)\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/g,
    '$1$4',
  )
}

// ---------------------------------------------------------------------------
// Push vers une branche protégée : explicite (main, HEAD:main, --all) ou
// implicite (HEAD, @, ou aucune destination : la branche courante est poussée).
// ---------------------------------------------------------------------------

const PROTEGEES = ['main', 'master', 'prod']
const GIT_PUSH = /\bgit\b([^;&|\n]*?)\bpush\b([^;&|\n]*)/g

type Push = { explicite: string | null; implicite: boolean; dossier: string | null }

function sansGuillemets(t: string): string {
  return t.replace(/^["']|["']$/g, '')
}

/** Les push d'une commande shell, avec leur destination protégée explicite ou le besoin de lire la branche courante. */
function analyserPushs(commande: string): Push[] {
  const pushs: Push[] = []
  for (const m of commande.matchAll(GIT_PUSH)) {
    const avant = m[1] ?? ''
    const tokens = (m[2] ?? '').trim().split(/\s+/).filter(Boolean)
    let explicite: string | null = null
    if (tokens.some(t => t === '--all' || t === '--mirror' || t === '--branches')) explicite = 'toutes les branches'
    const refspecs = tokens.filter(t => !t.startsWith('-')).slice(1)
    for (const r of refspecs) {
      const destination = (r.includes(':') ? (r.split(':').pop() ?? '') : r).replace(/^\+/, '').replace(/^refs\/heads\//, '')
      if (PROTEGEES.includes(destination)) explicite = destination
    }
    const implicite = explicite === null && (refspecs.length === 0 || refspecs.some(r => r === 'HEAD' || r === '@'))
    // Dossier du dépôt : `git -C <dossier>`, sinon le dernier `cd <dossier>` avant le push.
    const option = /-C\s+(\S+)/.exec(avant)
    const cds = [...commande.slice(0, m.index).matchAll(/\bcd\s+([^\s;&|]+)/g)]
    const dossier = option?.[1] ?? cds[cds.length - 1]?.[1] ?? null
    pushs.push({ explicite, implicite, dossier: dossier && sansGuillemets(dossier) })
  }
  return pushs
}

/** Branche courante du dépôt qui contient `dossier` (ou le dossier de la session) ; null si indéterminable. */
async function brancheCourante($: EngineInterface, dossier: string | null): Promise<string | null> {
  const cwd = await $.session.cwd()
  let d = dossier === null ? cwd : dossier.startsWith('/') ? dossier : `${cwd}/${dossier}`
  for (let i = 0; i < 12 && d.length > 0; i++) {
    let tete: string | null = null
    if (await $.fs.exists(`${d}/.git/HEAD`)) {
      tete = await $.fs.read(`${d}/.git/HEAD`)
    } else if (await $.fs.exists(`${d}/.git`)) {
      // Worktree : `.git` est un fichier « gitdir: <chemin> ».
      const gitdir = /^gitdir:\s*(.+)$/m.exec(await $.fs.read(`${d}/.git`))?.[1]?.trim()
      if (gitdir) tete = await $.fs.read(`${gitdir.startsWith('/') ? gitdir : `${d}/${gitdir}`}/HEAD`)
    }
    if (tete !== null) return /^ref: refs\/heads\/(.+)$/.exec(tete.trim())?.[1] ?? null
    const parent = d.replace(/\/[^/]+\/?$/, '')
    if (parent === d) break
    d = parent
  }
  return null
}

/** La branche protégée qu'une commande pousserait, ou null. Fail closed : branche indéterminable = protégée. */
async function pushProtege($: EngineInterface, commande: string): Promise<string | null> {
  for (const p of analyserPushs(commande)) {
    if (p.explicite !== null) return p.explicite
    if (p.implicite) {
      const branche = await brancheCourante($, p.dossier)
      if (branche === null) return 'branche courante indéterminable'
      if (PROTEGEES.includes(branche)) return branche
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Confidentialité généalogie : noms réels du GEDCOM, lus en local
// ---------------------------------------------------------------------------

function normaliser(t: string): string {
  return ` ${t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()} `
}

// Le propriétaire est public (site personnel, identifiant GitHub « oscar-roisin ») : jamais bloqué.
const EXCLUS = new Set(['oscar roisin', 'roisin oscar'])

function nomsDuGedcom(ged: string): string[] {
  const noms = new Set<string>()
  for (const ligne of ged.split(/\r?\n/)) {
    const m = /^1 NAME\s+(.*?)\s*\/([^/]+)\//.exec(ligne)
    if (!m) continue
    const prenoms = normaliser(m[1] ?? '').trim()
    const nom = normaliser(m[2] ?? '').trim()
    const premier = prenoms.split(' ')[0] ?? ''
    if (premier.length < 2 || nom.length < 2) continue
    noms.add(`${premier} ${nom}`)
    noms.add(`${nom} ${premier}`)
    if (prenoms !== premier) noms.add(`${prenoms} ${nom}`)
  }
  return [...noms].filter(n => !EXCLUS.has(n))
}

const cacheNoms = new Map<string, string[]>()

async function racineDepot($: EngineInterface, repo: string, texte: string): Promise<string | null> {
  const cwd = await $.session.cwd()
  const candidats: string[] = []
  const absolu = new RegExp(`(/[^\\s'"]*?/${repo})(?=/|\\s|$|'|")`).exec(texte)
  if (absolu?.[1]) candidats.push(absolu[1])
  const i = cwd.indexOf(`/${repo}`)
  if (i >= 0) candidats.push(cwd.slice(0, i + repo.length + 1))
  candidats.push(`${cwd}/${repo}`)
  for (const c of candidats) {
    if (await $.fs.exists(`${c}/data/famille.ged`)) return c
  }
  return null
}

async function nomReelPresent($: EngineInterface, repo: string, texte: string): Promise<string | null> {
  const racine = await racineDepot($, repo, texte)
  if (racine === null) return null
  let noms = cacheNoms.get(racine)
  if (noms === undefined) {
    noms = nomsDuGedcom(await $.fs.read(`${racine}/data/famille.ged`))
    cacheNoms.set(racine, noms)
  }
  // Références de branche (« oscar-roisin/claude/… ») et URL : identifiants, pas des personnes.
  const cible = normaliser(texte.replace(/\boscar-roisin\/\S*/gi, ' ').replace(/https?:\/\/\S+/g, ' '))
  const trouve = noms.find(n => cible.includes(` ${n} `))
  if (trouve === undefined) return null
  // Initiales seulement : le nom lui-même ne doit pas réapparaître dans la conversation.
  return trouve
    .split(' ')
    .map(p => `${p[0]?.toUpperCase() ?? ''}.`)
    .join(' ')
}

const PUBLICATION_GIT = /\bgit\b[^\n]*\b(commit|tag)\b|\bgh\s+(pr|issue)\s+(create|edit|comment|review)\b/

// ---------------------------------------------------------------------------
// Wavestone : pas de téléphone ni d'e-mail personnel dans les pages
// ---------------------------------------------------------------------------

const TELEPHONE = /(?:\+33\s?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const EMAIL_GENERIQUE = /cse|contact|info|accueil|support|no-?reply|rh|elus|secretariat/i

function donneePersonnelle(texte: string): string | null {
  if (TELEPHONE.test(texte)) return 'numéro de téléphone'
  for (const m of texte.matchAll(EMAIL)) {
    const local = m[0].split('@')[0] ?? ''
    if (!EMAIL_GENERIQUE.test(local)) return 'adresse e-mail non générique'
  }
  return null
}

// ---------------------------------------------------------------------------
// Physio : palette de marque figée, tokens « provisoire »
// ---------------------------------------------------------------------------

const PALETTE = /src\/styles\/tokens\/colors\.css$/
const TOKENS = /src\/styles\/tokens\/[^/]+\.css$/

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Thème, blocage
// ---------------------------------------------------------------------------

const ORDRE: Univers[] = ['perso', 'wavestone', 'physio']

let themeActuel: Univers | null = null

async function appliquer($: EngineInterface, ctx: Contexte): Promise<void> {
  if (ctx === null) return
  await update($, contexte, () => ctx)
  if (themeActuel === ctx.univers) return
  themeActuel = ctx.univers
  const set = await $.theme.set(THEMES[ctx.univers])
  if (!set.isDrawn) $.ui.status(`${LIBELLE[ctx.univers]} · ${set.reason}`)
}

async function bloquer($: EngineInterface, id: string, outil: string, regle: string): Promise<{ deny: string }> {
  await update($, interceptions, l => [...l, { id, regle, outil }].slice(-50))
  $.ui.toast(`Garde-fou : ${regle}`)
  return { deny: `${$.plugin.name} : ${regle}` }
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

const SEMAINE_MS = 7 * 24 * 3600 * 1000
const CINQ_H_MS = 5 * 3600 * 1000

/** Écart, en points, entre la part du quota consommée et la part de la fenêtre écoulée. */
function ecartAuRythme(pct: number, reset: string | undefined, dureeMs: number, maintenant: number): number | undefined {
  if (reset === undefined) return undefined
  const fin = Date.parse(reset)
  if (Number.isNaN(fin)) return undefined
  const ecoule = Math.min(1, Math.max(0, 1 - (fin - maintenant) / dureeMs))
  return Math.round(pct - ecoule * 100)
}

function semaineIso(ms: number): string {
  const d = new Date(ms)
  const jour = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - jour + 3)
  const premierJeudi = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const n = 1 + Math.round((d.getTime() - premierJeudi.getTime()) / (7 * 24 * 3600 * 1000))
  return `${d.getUTCFullYear()}-S${String(n).padStart(2, '0')}`
}

function heure(reset: string | undefined): string {
  if (reset === undefined) return ''
  const d = new Date(reset)
  if (Number.isNaN(d.getTime())) return ''
  const jours = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
  return `${jours[d.getDay()]} ${String(d.getHours()).padStart(2, '0')} h ${String(d.getMinutes()).padStart(2, '0')}`
}

async function alerterUneFois($: EngineInterface, cle: string, texte: string): Promise<void> {
  const deja = await read($, alertes)
  if (deja.includes(cle)) return
  await update($, alertes, l => [...l, cle].slice(-30))
  $.ui.toast(texte)
}

async function mesurer($: EngineInterface): Promise<void> {
  const maintenant = await $.clock.now()
  const usage = await $.session.usage()
  const cinq = usage.rateLimits.find(r => r.kind === 'five_hour')
  const sept = usage.rateLimits.find(r => r.kind === 'seven_day')
  const cinqHeures: Fenetre | undefined = cinq && {
    pct: cinq.percentUsed,
    reset: cinq.resetsAt,
    ecart: ecartAuRythme(cinq.percentUsed, cinq.resetsAt, CINQ_H_MS, maintenant),
  }
  const semaine: Fenetre | undefined = sept && {
    pct: sept.percentUsed,
    reset: sept.resetsAt,
    ecart: ecartAuRythme(sept.percentUsed, sept.resetsAt, SEMAINE_MS, maintenant),
  }
  const economie =
    (semaine !== undefined && (semaine.pct >= 80 || (semaine.ecart ?? 0) >= 15)) ||
    (cinqHeures !== undefined && cinqHeures.pct >= 90)
  const avant = await read($, jauges)
  await update($, jauges, () => ({ contexte: usage.context.percent, cinqHeures, semaine, economie }))

  // Alertes, une fois par seuil et par fenêtre.
  const ctx = usage.context.percent ?? 0
  if (ctx >= 85) await alerterUneFois($, `ctx85-${usage.startedAt}`, 'Contexte à 85 % : /compact maintenant, ou une nouvelle session.')
  else if (ctx >= 70) await alerterUneFois($, `ctx70-${usage.startedAt}`, 'Contexte à 70 % : penser à /compact.')
  if (semaine) {
    for (const seuil of [95, 85, 70]) {
      if (semaine.pct >= seuil) {
        await alerterUneFois($, `sem${seuil}-${semaine.reset}`, `Quota hebdomadaire à ${Math.round(semaine.pct)} % (remise à zéro ${heure(semaine.reset)}).`)
        break
      }
    }
  }
  if (cinqHeures && cinqHeures.pct >= 90) {
    await alerterUneFois($, `5h90-${cinqHeures.reset}`, `Fenêtre de 5 h à ${Math.round(cinqHeures.pct)} % : remise à zéro ${heure(cinqHeures.reset)}.`)
  }
  if (economie && !avant.economie) $.ui.toast('Mode économie : sous-agents sur Sonnet, lectures ciblées.')

  // Consommation par univers et par semaine (coût estimé, pas la facture), gardée entre les sessions.
  const cout = usage.cost?.usd
  if (cout !== undefined) {
    const precedent = await read($, dernierCout)
    const delta = precedent < 0 || cout < precedent ? 0 : cout - precedent
    await update($, dernierCout, () => cout)
    const univers = (await read($, contexte))?.univers
    if (delta > 0 && univers) {
      const cle = `conso:${semaineIso(maintenant)}`
      const conso = ((await $.store.get(cle)) ?? {}) as Partial<Record<Univers, number>>
      conso[univers] = (conso[univers] ?? 0) + delta
      await $.store.set(cle, conso)
    }
  }
}

function texteJauges(j: Jauges): string {
  const morceaux: string[] = []
  if (j.contexte !== undefined) morceaux.push(`ctx ${Math.round(j.contexte)} %`)
  if (j.cinqHeures) morceaux.push(`5 h ${Math.round(j.cinqHeures.pct)} %`)
  if (j.semaine) {
    const e = j.semaine.ecart
    morceaux.push(`sem. ${Math.round(j.semaine.pct)} %${e !== undefined && Math.abs(e) >= 5 ? ` (${e > 0 ? '+' : ''}${e} pts)` : ''}`)
  }
  return morceaux.join(' · ')
}

function couleur(pct: number | undefined, orange: number, rouge: number): 'error' | 'warning' | undefined {
  if (pct === undefined) return undefined
  if (pct >= rouge) return 'error'
  if (pct >= orange) return 'warning'
  return undefined
}

// ---------------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (BLOQUANTS.length > 0) $.ui.toast(BLOQUANTS[0] ?? '')
    await $.command.register({ name: 'univers', description: 'Choisir le thème : wavestone, physio ou perso' })
    await $.command.register({ name: 'garde-fous', description: 'Lister les actions bloquées dans cette session' })
    await $.command.register({
      name: 'autoriser-push',
      description: 'Autoriser une fois, pendant 10 min, un push vers main, master ou prod (à taper soi-même)',
    })
    await $.command.register({ name: 'quota', description: 'Quota : fenêtres 5 h et 7 jours, rythme, consommation par univers' })
    await appliquer($, detecter(e.cwd))
    await mesurer($)
    return next(e)
  })

  on('command.run', { command: 'univers' }, async ($, e) => {
    const choix = e.args.trim().toLowerCase() as Univers
    if (!(choix in THEMES)) return { text: 'Usage : /univers wavestone | physio | perso' }
    const ctx = (await read($, contexte)) ?? { repo: '', univers: choix }
    await appliquer($, { ...ctx, univers: choix })
    return { text: `Thème ${LIBELLE[choix]} appliqué.` }
  })

  // Seule une saisie de la personne (clavier ou application) vaut autorisation : ni le modèle, ni un autre agent.
  on('command.run', { command: 'autoriser-push' }, async ($, e) => {
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') {
      return { text: 'Refusé : /autoriser-push ne vaut que tapé par Oscar.' }
    }
    const jusqua = (await $.clock.now()) + AUTORISATION_MS
    await update($, autorisation, () => ({ jusqua }))
    return { text: 'Un push vers main, master ou prod est autorisé une fois, pendant 10 minutes.' }
  })

  on('command.run', { command: 'garde-fous' }, async $ => {
    const liste = await read($, interceptions)
    if (liste.length === 0) return { text: 'Aucune action bloquée dans cette session.' }
    return { text: liste.map(i => `- ${i.outil} : ${i.regle}`).join('\n') }
  })

  on('command.run', { command: 'quota' }, async $ => {
    await mesurer($)
    const j = await read($, jauges)
    const lignes: string[] = []
    if (j.cinqHeures) lignes.push(`Fenêtre 5 h : ${j.cinqHeures.pct} % (remise à zéro ${heure(j.cinqHeures.reset)})`)
    if (j.semaine) {
      const e = j.semaine.ecart
      const rythme = e === undefined ? '' : e > 0 ? `, ${e} pts au-dessus du rythme régulier` : `, ${-e} pts sous le rythme régulier`
      lignes.push(`Semaine : ${j.semaine.pct} %${rythme} (remise à zéro ${heure(j.semaine.reset)})`)
    }
    if (lignes.length === 0) lignes.push('Fenêtres de quota : non communiquées par cette session.')
    lignes.push(`Mode économie : ${j.economie ? 'actif' : 'inactif'}`)
    const conso = ((await $.store.get(`conso:${semaineIso(await $.clock.now())}`)) ?? {}) as Partial<Record<Univers, number>>
    const total = ORDRE.reduce((n, u) => n + (conso[u] ?? 0), 0)
    if (total > 0) {
      lignes.push('Cette semaine, par univers (coût estimé, part du total) :')
      for (const u of ORDRE) {
        const v = conso[u] ?? 0
        if (v > 0) lignes.push(`- ${LIBELLE[u]} : ~${v.toFixed(2)} $ (${Math.round((100 * v) / total)} %)`)
      }
    }
    return { text: lignes.join('\n') }
  })

  on('tool.call', async ($, e, next) => {
    const outil = String(e.tool)
    const id = e.tool_use_id

    // Contexte de l'appel : chemin du fichier ou texte de la commande, sinon le contexte en cours.
    let texte = ''
    if (e.tool === 'Bash') texte = e.command
    else if (e.tool === 'Write' || e.tool === 'Edit') texte = e.file_path
    else texte = JSON.stringify(e)
    const ctx = detecter(texte) ?? detecter(await $.session.cwd()) ?? (await read($, contexte))
    await appliquer($, ctx)

    // 1. Règles git
    if (e.tool === 'Bash') {
      const commande = sansHeredocs(e.command)
      const regle = regleGit(commande, ctx?.univers)
      if (regle) return bloquer($, id, outil, regle)
      const cible = await pushProtege($, commande)
      if (cible !== null) {
        const auto = await read($, autorisation)
        if (auto !== null && auto.jusqua > (await $.clock.now())) {
          await update($, autorisation, () => null)
          $.ui.toast(`Push vers « ${cible} » autorisé par Oscar (usage unique, consommé).`)
        } else {
          return bloquer($, id, outil, `push vers « ${cible} » interdit : passer par une PR, ou Oscar tape /autoriser-push.`)
        }
      }
    }
    if (/merge_pull_request/.test(outil) && ctx?.univers !== 'physio') {
      return bloquer($, id, outil, 'fusion de PR réservée à Oscar.')
    }

    // 2. Généalogie : aucun nom réel dans un commit, un tag, une PR ou un ticket
    if (ctx?.repo.startsWith('genealogie-roisin')) {
      const publie =
        (e.tool === 'Bash' && PUBLICATION_GIT.test(e.command)) ||
        (/github/i.test(outil) && /create|update|comment|review|push|write/i.test(outil))
      if (publie) {
        const initiales = await nomReelPresent($, ctx.repo, texte)
        if (initiales) {
          return bloquer($, id, outil, `nom réel du GEDCOM (${initiales}) dans un texte publié : le retirer.`)
        }
      }
    }

    // 3. Wavestone : pages du CSE
    if (ctx?.univers === 'wavestone' && (e.tool === 'Write' || e.tool === 'Edit')) {
      if (/content\/pages\/[^/]+\.md$/.test(e.file_path)) {
        const contenu = e.tool === 'Write' ? e.content : e.new_string
        const trouve = donneePersonnelle(contenu)
        if (trouve) return bloquer($, id, outil, `${trouve} dans une page du CSE : contact générique seulement.`)
      }
    }

    // 4. Physio : palette figée, tokens provisoires
    if (ctx?.univers === 'physio' && (e.tool === 'Write' || e.tool === 'Edit')) {
      if (PALETTE.test(e.file_path)) {
        return bloquer($, id, outil, 'palette de marque (colors.css) : décision dans Claude Design d’abord.')
      }
      if (TOKENS.test(e.file_path)) {
        const ran = await next(e)
        if (ran.deny !== undefined) return ran
        const tete = (await $.fs.read(e.file_path)).split('\n').slice(0, 20).join('\n')
        if (!/provisoire/i.test(tete)) {
          return {
            ...ran,
            context: [
              ...(ran.context ?? []),
              'Token modifié localement : ajouter « provisoire » dans l’en-tête du fichier jusqu’à validation par Claude Design (/design-sync).',
            ],
          }
        }
        return ran
      }
    }

    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${$.plugin.name} : le garde-fou a échoué.` }))

  // Répartition des modèles ; en mode économie, Opus est refusé aux sous-agents généralistes.
  on('agent.spawn', async ($, e, next) => {
    const generaliste = ['general-purpose', 'Plan', 'claude'].includes(e.subagentType)
    const { economie } = await read($, jauges)
    if (generaliste && e.model === undefined && /opus/i.test(e.parentModel)) {
      $.ui.toast('Sous-agent lancé sur Sonnet (Opus réservé aux arbitrages).')
      return next({ ...e, model: 'sonnet' })
    }
    if (e.model !== undefined && /opus/i.test(e.model)) {
      if (economie && generaliste) {
        $.ui.toast('Mode économie : sous-agent passé d’Opus à Sonnet.')
        return next({ ...e, model: 'sonnet' })
      }
      $.ui.toast('Sous-agent sur Opus : à réserver aux arbitrages et aux revues finales.')
    }
    return next(e)
  })

  // Mode économie : une consigne courte ajoutée au prompt système, seulement quand il est actif.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, jauges)).economie) return composed
    return {
      sections: [
        ...composed.sections,
        {
          id: 'roisin-garde-fous:economie',
          scope: 'session',
          text:
            'Quota serré : lire les fichiers par extraits (Grep, offset/limit) plutôt qu’en entier, ' +
            'ne lancer un sous-agent que s’il évite clairement du travail, éviter de relire ce qui est déjà dans la conversation, ' +
            'réponses courtes.',
        },
      ],
    }
  })

  // Après chaque tour : jauges, alertes, ligne d'état.
  on('turn.complete', async ($, e, next) => {
    await mesurer($)
    const ctx = await read($, contexte)
    const j = await read($, jauges)
    const morceaux = [ctx ? LIBELLE[ctx.univers] : '', texteJauges(j), j.economie ? 'économie' : ''].filter(Boolean)
    $.ui.status(morceaux.length > 0 ? morceaux.join(' · ') : undefined)
    return next(e)
  })

  // Carte sous la ligne d'un outil bloqué (carte sur mobile, ligne sous l'outil ailleurs).
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const bloc = (await read($, interceptions)).find(i => i.id === e.props.tool_use_id)
    if (bloc === undefined) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1}>
        {await next(e)}
        <Text color="error" bold>
          Bloqué par le garde-fou
        </Text>
        <Text>{bloc.regle}</Text>
      </Box>
    )
  })

  // Bandeau : univers (bouton), dépôt et sensibilité, jauges colorées, blocages (bouton).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ctx = await read($, contexte)
    if (e.props.hasSurvey || ctx === null) return next(e)
    const liste = await read($, interceptions)
    const j = await read($, jauges)
    const estOuvert = await read($, ouvert)
    const { Box, Text, Button } = $.ui.resolve(e)
    const sensibilite = SENSIBILITE[ctx.repo]
    const etroit = e.surface === 'mobile'

    const changerUnivers = async () => {
      const suivant = ORDRE[(ORDRE.indexOf(ctx.univers) + 1) % ORDRE.length] ?? 'perso'
      await appliquer($, { ...ctx, univers: suivant })
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
          <Button key="univers" hotkey="u" onPress={changerUnivers}>
            {LIBELLE[ctx.univers]}
          </Button>
          <Text dimColor>
            {ctx.repo && !etroit ? ctx.repo : ''}
            {sensibilite ? `${ctx.repo && !etroit ? ' · ' : ''}${sensibilite}` : ''}
          </Text>
        </Box>
        <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
          {j.contexte !== undefined ? <Text color={couleur(j.contexte, 70, 85)}>ctx {Math.round(j.contexte)} %</Text> : null}
          {j.cinqHeures ? <Text color={couleur(j.cinqHeures.pct, 70, 90)}>5 h {Math.round(j.cinqHeures.pct)} %</Text> : null}
          {j.semaine ? (
            <Text color={couleur(j.semaine.pct, 70, 85) ?? ((j.semaine.ecart ?? 0) >= 15 ? 'warning' : undefined)}>
              sem. {Math.round(j.semaine.pct)} %
              {j.semaine.ecart !== undefined && Math.abs(j.semaine.ecart) >= 5
                ? ` (${j.semaine.ecart > 0 ? '+' : ''}${j.semaine.ecart} pts)`
                : ''}
            </Text>
          ) : null}
          {j.economie ? <Text color="warning" bold>économie</Text> : null}
          {liste.length > 0 ? (
            <Button key="blocages" hotkey="b" onPress={() => update($, ouvert, v => !v)}>
              {`Blocages (${liste.length})`}
            </Button>
          ) : null}
        </Box>
        {estOuvert && liste.length > 0 ? (
          <Box flexDirection="column">
            {liste.slice(-5).map(i => (
              <Text key={i.id} dimColor>
                {`· ${i.regle}`}
              </Text>
            ))}
          </Box>
        ) : null}
      </Box>
    )
  })
}
