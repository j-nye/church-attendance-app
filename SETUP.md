# One-time machine setup

Secrets for this project (`DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`,
`AUTH_GOOGLE_SECRET`, `SEED_ADMIN_EMAIL`) live in [Doppler](https://doppler.com), not in
a `.env.local` file you copy between machines. [direnv](https://direnv.net) loads them
into your shell automatically whenever you `cd` into the repo, via the committed
`.envrc`. Do this once per machine.

You need to already be a member of the `church-attendance-app` Doppler project — ask
whoever set it up to invite you if you aren't.

## macOS

```bash
brew install dopplerhq/cli/doppler direnv
```

Hook direnv into your shell (one line, one time). For zsh (macOS default):
```bash
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc && source ~/.zshrc
```
For bash, use `~/.bashrc` and `direnv hook bash` instead.

## Linux / Windows (WSL)

direnv doesn't support native PowerShell — Windows contributors should do this inside
WSL, exactly like Linux.

```bash
curl -Ls https://cli.doppler.com/install.sh | sudo sh
curl -sfL https://direnv.net/install.sh | sudo bash
```
(Or use your distro's package manager, e.g. `apt install direnv`, if it has a
reasonably current version.)

Hook direnv into your shell:
```bash
echo 'eval "$(direnv hook bash)"' >> ~/.bashrc && source ~/.bashrc
```
Use `~/.zshrc` and `direnv hook zsh` if you use zsh instead.

## Everyone, after the above

```bash
doppler login          # opens a browser to authenticate the CLI
git clone https://github.com/j-nye/church-attendance-app.git
cd church-attendance-app
direnv allow           # direnv refuses to auto-load a repo's .envrc until you trust it once
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

No `doppler run --` prefix needed anywhere — once `direnv allow` has run, secrets are
just in your shell's environment for any command, editor, or test runner you use in
this directory.

## Troubleshooting

- **`direnv: error .envrc is blocked`** — run `direnv allow` (direnv re-blocks the file
  any time its contents change, including after a `git pull` that touches `.envrc`).
- **Changed a secret in the Doppler dashboard but don't see it locally** — direnv only
  re-runs `.envrc` when you enter the directory or the file's contents change. Force a
  refresh with `direnv reload`, or just `cd .. && cd -`.
- **`doppler: command not found` after install** — open a new terminal (or
  `source` your shell rc file) so your `PATH` picks up the newly installed binary.
