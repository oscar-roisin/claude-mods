import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Moteur = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

const GED_FICTIF = ['0 HEAD', '0 @I1@ INDI', '1 NAME Jeanne /Dupontel/'].join('\n')

function moteur(on: On, cwd: string): void {
  on('session.cwd', () => ({ value: cwd }))
  on('fs.exists', (_: unknown, e: { path: string }) => ({
    value: e.path.endsWith('genealogie-roisin-website/data/famille.ged') || e.path === '/depot/.git/HEAD',
  }))
  on('fs.read', (_: unknown, e: { path: string }) => ({
    value: e.path.endsWith('famille.ged') ? GED_FICTIF : 'ref: refs/heads/feat/x\n',
  }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 't' } }))
  on('tool.call', () => ({ result: {} }))
}

const bash = ($: Moteur, command: string) => $.tool.call({ tool: 'Bash', command })

test('un heredoc qui cite une commande interdite passe', async ($, on) => {
  moteur(on, '/depot')
  const readme = ["cat > README.md <<'EOF'", '- refuse `git add -A` et `git push origin main`', 'EOF'].join('\n')
  expect((await bash($, readme)).deny).toBeUndefined()
  const tiret = ['cat <<-FIN > notes.md', '\tgit push --force', '\tFIN'].join('\n')
  expect((await bash($, tiret)).deny).toBeUndefined()
})

test('une vraie commande autour du heredoc reste contrôlée', async ($, on) => {
  moteur(on, '/depot')
  // Sur la ligne d'ouverture.
  const ouverture = ["cat > a.md <<'EOF' && git add .", 'texte', 'EOF'].join('\n')
  expect((await bash($, ouverture)).deny).toMatch(/nommer les fichiers/)
  // Après le délimiteur de fin.
  const apres = ["cat > a.md <<'EOF'", 'texte', 'EOF', 'git push origin main'].join('\n')
  expect((await bash($, apres)).deny).toMatch(/« main »/)
})

test('généalogie : un nom réel dans un message de commit en heredoc reste refusé', async ($, on) => {
  moteur(on, '/home/user/genealogie-roisin-website')
  const commit = ["git commit -F - <<'EOF'", 'data: corrige la naissance de Jeanne Dupontel', 'EOF'].join('\n')
  expect((await bash($, commit)).deny).toMatch(/GEDCOM/)
})
