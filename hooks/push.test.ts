import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Moteur = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

// Dépôt fictif : /depot sur la branche donnée, /depot/sous/dossier à l'intérieur.
function moteur(on: On, branche: string, cwd = '/depot'): void {
  on('session.cwd', () => ({ value: cwd }))
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: e.path === '/depot/.git/HEAD' }))
  on('fs.read', () => ({ value: `ref: refs/heads/${branche}\n` }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 't' } }))
  on('tool.call', () => ({ result: {} }))
  on('clock.now', () => ({ value: 1_000_000 }))
}

const bash = ($: Moteur, command: string) => $.tool.call({ tool: 'Bash', command })

const commande = ($: Moteur, kind: string) =>
  $.command.run({
    command: 'autoriser-push',
    args: '',
    origin: { kind },
    presentation: { layout: 'main', columns: 80 },
  } as never)

test('push implicite depuis main : refusé (HEAD, @, sans destination)', async ($, on) => {
  moteur(on, 'main')
  expect((await bash($, 'git push origin HEAD')).deny).toMatch(/« main »/)
  expect((await bash($, 'git push -u origin HEAD')).deny).toMatch(/« main »/)
  expect((await bash($, 'git push origin @')).deny).toMatch(/« main »/)
  expect((await bash($, 'git push')).deny).toMatch(/« main »/)
  expect((await bash($, 'cd sous/dossier && git push')).deny).toMatch(/« main »/)
})

test('push explicite : HEAD:main, refs/heads/prod, --all refusés ; feature acceptée', async ($, on) => {
  moteur(on, 'feat/x')
  expect((await bash($, 'git push origin HEAD:main')).deny).toMatch(/« main »/)
  expect((await bash($, 'git push origin HEAD:refs/heads/prod')).deny).toMatch(/« prod »/)
  expect((await bash($, 'git push --all origin')).deny).toMatch(/toutes les branches/)
  expect((await bash($, 'git push origin HEAD')).deny).toBeUndefined()
  expect((await bash($, 'git push -u origin feat/x')).deny).toBeUndefined()
  expect((await bash($, 'git -C /depot push')).deny).toBeUndefined()
})

test('branche indéterminable : refusé (fail closed)', async ($, on) => {
  moteur(on, 'main', '/ailleurs')
  expect((await bash($, 'git push')).deny).toMatch(/indéterminable/)
})

test('/autoriser-push : tapé par Oscar, un seul push, puis de nouveau refusé', async ($, on) => {
  moteur(on, 'main')
  const r = await commande($, 'composer')
  expect(r.text).toMatch(/autorisé une fois/)
  expect((await bash($, 'git push origin HEAD')).deny).toBeUndefined()
  expect((await bash($, 'git push origin HEAD')).deny).toMatch(/« main »/)
})

test('/autoriser-push venu d’un autre agent : refusé', async ($, on) => {
  moteur(on, 'main')
  expect((await commande($, 'peer-send-message')).text).toMatch(/Refusé/)
  expect((await bash($, 'git push origin HEAD')).deny).toMatch(/« main »/)
})
