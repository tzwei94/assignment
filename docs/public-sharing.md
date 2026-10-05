# Public repository status and maintenance

The three repositories are already **public**. GitHub visibility and published branch/tag heads were checked on 27 September 2026:

| Repository | Default branch | Published commit inspected |
|---|---|---|
| [banking-platform](https://github.com/tzwei94/banking-platform) | `main` | `6b45677` |
| [banking-api](https://github.com/tzwei94/banking-api) | `main` | `1035aeb` |
| [banking-infrastructure](https://github.com/tzwei94/banking-infrastructure) | `main` | `3a1763a` |

At that check, the parent pinned the application and deployment commits above. Keep their workflows in their own repositories. Commit and push submodule changes before updating the parent references, so a recursive clone can retrieve the pinned commits.

On 5 October 2026, the repositories were renamed from `assignment`, `app` and `deployment` to `banking-platform`, `banking-api` and `banking-infrastructure`. Repository identities and history are retained. The workspace still uses `app/` and `deployment/` submodule directories. Repository URLs, Actions handoff settings and Terraform repository names use the new names.

Existing image manifests retain the repository name recorded at publication. Select a fresh successful CI/publish run under the new name when creating a new release or resolving a new Alloy publication.

## History review

The published refs inspected contain two parent commits and one initial commit in each submodule. No source PDF or `.private/` path was found in those histories. The earlier blanket warning that these published repositories still contain the original private-source history is outdated.

The local checkout also has Codex checkpoint refs. Those are separate from the published `main` branches; do not publish local recovery refs with a mirror push. This audit did not certify unreachable objects, forks, cached PR diffs, release attachments or old clones.

Gitleaks scanned the local branches, remote-tracking refs and tags matching the published heads. It reported no findings in the parent or deployment repository and one application finding: the PEM delimiters in `BankingAcceptanceTest.java`. That test generates its RSA key at runtime; the finding is not a committed private key. Scanner results are not a guarantee: manual review also found a Grafana viewer password in the published observability guide, which the scanner did not flag.

## Viewer credentials

The documentation update removes the viewer password from the current guide. Obtain access privately from the environment owner. Removal does not revoke the published password or erase the previous commit: the owner should rotate it in Grafana and review existing sessions. No password rotation or history rewrite was performed by this documentation update.

The review account can query shared telemetry data sources, beyond the three dashboard filters. Its exact recorded scope is in [viewer access](observability/viewer-access.md). Keep backend and administrator credentials private.

## Ongoing publication checks

Keep source PDFs, private plans, populated Terraform profiles/state, signing keys, credentials, database dumps and operational captures out of Git. Example profiles, synthetic fixtures, approved public service URLs and dependency digests can remain in source.

Before publishing changes, inspect the staged diff and scan each repository separately. For example, from the parent repository:

```sh
gitleaks git --redact --log-opts='--branches --remotes --tags' .
gitleaks git --redact --log-opts='--branches --remotes --tags' app
gitleaks git --redact --log-opts='--branches --remotes --tags' deployment
```

Review each finding; do not suppress real credentials to obtain a green scan. These commands scan committed history, so also inspect uncommitted/staged changes before committing. If a real credential is published, revoke or rotate it first, then coordinate any necessary history cleanup across affected repositories and refs.

## GitHub configuration

The checked-in workflows send application PR checks to GitHub-hosted runners and restrict image publication to main-branch pushes. Deployment is manually dispatched from `main` through the `dev` environment. Both trusted jobs use the shared private EC2 host.

Branch protection, environment approvals and runner-group restrictions are GitHub settings, not guaranteed by these workflow files. Review those settings independently. A workflow-level condition alone does not prevent a contributor from proposing a different self-hosted job; enforce the intended runner trust boundary outside untrusted workflow code. Review Actions logs and artifact access before sharing operational results.

Repository visibility was verified; live branch protection and runner authorization settings were not audited here. Licensing and rights to included material remain the owner's responsibility.
