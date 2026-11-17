export type Univers = 'wavestone' | 'physio' | 'perso'

export type Contexte = { repo: string; univers: Univers } | null

/** Une action refusée ; `id` est le tool_use_id, pour la carte sous la ligne de l'outil. */
export type Interception = { id: string; regle: string; outil: string }

/** Une fenêtre de quota : pourcentage utilisé, réinitialisation, écart au rythme régulier (en points). */
export type Fenetre = { pct: number; reset?: string; ecart?: number }

export type Jauges = {
  contexte?: number
  cinqHeures?: Fenetre
  semaine?: Fenetre
  economie: boolean
}

/** Autorisation à usage unique, valable jusqu'à `jusqua` (ms). */
export type Autorisation = { jusqua: number } | null

declare module 'claude-code' {
  interface PluginState {
    'roisin-garde-fous': {
      contexte: Shaped<Contexte>
      interceptions: Shaped<Interception[]>
      jauges: Shaped<Jauges>
      alertes: Shaped<string[]>
      dernierCout: number
      ouvert: boolean
      autorisation: Shaped<Autorisation>
    }
  }
}
