import type { ThemeSetArgs } from 'claude-code'

import type { Univers } from '../types'
import { makeColors } from './make-colors.js'

// Wavestone : violet profond, d'après la palette du dépôt wavestone-cse-intranet (design/tokens).
const wavestone = makeColors({
  label: 'Wavestone',
  roles: { accent: '#451dc7', danger: '#c0263a', success: '#0f7a52', warning: '#a86f14', pro: '#e5178f' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#eeecf7',
        'surface-1': '#f3f1fa',
        'surface-2': '#f7f6fb',
        'text-primary': '#140f33',
        'text-secondary': '#2e2757',
        'text-muted': '#4f4878',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#120d2e',
        'surface-1': '#181238',
        'surface-2': '#1e1742',
        'surface-3': '#241c4c',
        'text-primary': '#efecfb',
        'text-secondary': '#cdc7ea',
        'text-muted': '#a9a2cf',
      },
    },
  },
})

// Physio Ourcq : crème et marine, d'après src/styles/tokens/colors.css (palette de marque inchangée).
const physio = makeColors({
  label: 'Physio Ourcq',
  roles: { accent: '#0a6fa8', danger: '#b3392f', success: '#1f7f72', warning: '#9a7a00', pro: '#0e4a8c' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#eef1ea',
        'surface-1': '#f3f5ee',
        'surface-2': '#f8f8f0',
        'text-primary': '#14283f',
        'text-secondary': '#33475b',
        'text-muted': '#4d6074',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0b1a2b',
        'surface-1': '#0f2134',
        'surface-2': '#13283e',
        'surface-3': '#172e46',
        'text-primary': '#eaf4f8',
        'text-secondary': '#c3d6e0',
        'text-muted': '#9db6c4',
      },
    },
  },
})

// Perso (généalogie, site personnel) : papier ancien le jour, carnet à la lampe la nuit.
const perso = makeColors({
  label: 'Perso',
  roles: { accent: '#2f5d8c', danger: '#b3392f', success: '#4e7d3a', warning: '#a86f14', pro: '#7a2e5a' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#efe6d3',
        'surface-1': '#f4ecdc',
        'surface-2': '#faf5e9',
        'text-primary': '#2a241d',
        'text-secondary': '#544a3d',
        'text-muted': '#6a5f50',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#1f1a15',
        'surface-1': '#28221b',
        'surface-2': '#312a22',
        'surface-3': '#3a3229',
        'text-primary': '#f0e7d7',
        'text-secondary': '#cfc4b2',
        'text-muted': '#aca08d',
      },
    },
  },
})

const built = { wavestone, physio, perso }

export const THEMES: Record<Univers, ThemeSetArgs> = {
  wavestone: { colors: wavestone.theme },
  physio: { colors: physio.theme },
  perso: { colors: perso.theme },
}

/** Lignes qui empêcheraient Desktop de peindre un thème. */
export const BLOQUANTS: string[] = Object.entries(built).flatMap(([nom, b]) =>
  b.problems.filter(p => p.startsWith("Desktop won't paint")).map(p => `${nom}: ${p}`),
)
