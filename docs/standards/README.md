# Standards

Canonical artifacts shared across all repos. Edit here, copy out.

## `gitignore-secrets.txt`

Append block added to every repo's `.gitignore` to catch common secret-shaped files
(`.env*`, `*.pem`, `credentials*.json`, etc.). Whitelists `.env.example` / `.env.sample`.

## `pre-commit-config.yaml`

Drop as `.pre-commit-config.yaml` at repo root, then run `pre-commit install`.
Installs a pre-commit hook that runs [gitleaks](https://github.com/gitleaks/gitleaks)
against staged changes and blocks commits that introduce matches.

## Machine setup (one-time)

```bash
pip install pre-commit
# gitleaks: download latest windows_x64.zip from github.com/gitleaks/gitleaks/releases
# direnv:   download windows-amd64 binary from github.com/direnv/direnv/releases
# drop both in ~/.local/bin/ (or wherever is on PATH)
git config --global core.excludesfile ~/.config/git/ignore
```

See Atrium task `feat-secrets-audit-001` for the full audit + rollout plan.
