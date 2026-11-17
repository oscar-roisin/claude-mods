import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Moteur = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

// GEDCOM fictif : aucune donnée réelle dans les tests.
const GED_FICTIF = ['0 HEAD', '0 @I1@ INDI', '1 NAME Jeanne Marie /Dupontel/', '0 @I2@ INDI', '1 NAME Éloi /Brémont/'].join(
  '\n',
)

function moteur(on: On, cwd: string): void {
  on('session.cwd', () => ({ value: cwd }))
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: String(e.path).endsWith('genealogie-roisin-website/data/famille.ged') }))
  on('fs.read', () => ({ value: GED_FICTIF }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 't' } }))
  on('tool.call', () => ({ result: {} }))
}

async function appel($: Moteur, command: string) {
  return $.tool.call({ tool: 'Bash', command })
}

test('git : add -A, push forcé, push sur main, rm -rf hors build', async ($, on) => {
  moteur(on, '/home/user/wavestone-cse-intranet')
  expect((await appel($, 'git add -A')).deny).toMatch(/nommer les fichiers/)
  expect((await appel($, 'git add .')).deny).toMatch(/nommer les fichiers/)
  expect((await appel($, 'git add src/a.ts')).deny).toBeUndefined()
  expect((await appel($, 'git push --force origin feat/x')).deny).toMatch(/forcé/)
  expect((await appel($, 'git push --force-with-lease origin feat/x')).deny).toBeUndefined()
  expect((await appel($, 'git push origin main')).deny).toMatch(/main/)
  expect((await appel($, 'git push -u origin feat/x')).deny).toBeUndefined()
  expect((await appel($, 'rm -rf node_modules dist')).deny).toBeUndefined()
  expect((await appel($, 'rm -rf src')).deny).toMatch(/rm -rf/)
})

test('fusion : refusée hors Physio, laissée à garde-prod sur Physio', async ($, on) => {
  moteur(on, '/home/user')
  expect((await appel($, 'cd genealogie-roisin-website && gh pr merge 12')).deny).toMatch(/Oscar/)
  expect((await appel($, 'cd physio-ourcq-website && gh pr merge 12')).deny).toBeUndefined()
})

test('généalogie : nom réel dans un commit refusé, sans réécrire le nom', async ($, on) => {
  moteur(on, '/home/user/genealogie-roisin-website')
  const refus = await appel($, 'git commit -m "data: corrige la naissance de Jeanne DUPONTEL"')
  expect(refus.deny).toMatch(/J\. D\./)
  expect(refus.deny).not.toMatch(/Dupontel/i)
  expect((await appel($, 'git commit -m "data: brémont éloi, lieu"')).deny).toMatch(/GEDCOM/)
  expect((await appel($, 'git commit -m "fix(core): libellé de parenté"')).deny).toBeUndefined()
  // Hors commit/PR, pas de contrôle (lecture, recherche).
  expect((await appel($, 'grep -n "Dupontel" data/famille.ged')).deny).toBeUndefined()
})

test('Wavestone : téléphone et e-mail personnel refusés dans une page', async ($, on) => {
  moteur(on, '/home/user/wavestone-cse-intranet')
  const page = '/home/user/wavestone-cse-intranet/content/pages/contact.md'
  const tel = await $.tool.call({ tool: 'Write', file_path: page, content: 'Appeler le 06 12 34 56 78' })
  expect(tel.deny).toMatch(/téléphone/)
  const mail = await $.tool.call({ tool: 'Write', file_path: page, content: 'jean.martin@wavestone.com' })
  expect(mail.deny).toMatch(/e-mail/)
  const ok = await $.tool.call({ tool: 'Write', file_path: page, content: 'Écrire à cse@wavestone.com' })
  expect(ok.deny).toBeUndefined()
})

test('Physio : palette de marque protégée', async ($, on) => {
  moteur(on, '/home/user/physio-ourcq-website')
  const r = await $.tool.call({
    tool: 'Edit',
    file_path: '/home/user/physio-ourcq-website/src/styles/tokens/colors.css',
    old_string: 'a',
    new_string: 'b',
  })
  expect(r.deny).toMatch(/Claude Design/)
})

test('sous-agent généraliste lancé sous Opus : passe sur Sonnet', async ($, on) => {
  let modele: string | undefined
  on('agent.spawn', (_, e) => {
    modele = e.model
    return { model: e.model ?? e.parentModel }
  })
  await $.agent.spawn({
    tool_use_id: 't1',
    prompt: 'implémente',
    description: 'impl',
    subagentType: 'general-purpose',
    parentModel: 'claude-opus-5-5',
  } as never)
  expect(modele).toBe('sonnet')
})
