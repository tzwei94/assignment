# Publishing the repositories

The project uses synthetic accounts and example service URLs. Keep the application and deployment repositories separate so their GitHub Actions workflows run at each repository root. Commit submodule changes before updating their references in the parent repository.

## Git history

Earlier history contains the source PDF and personal infrastructure references. Remove private material from all affected refs before making the repositories public; deleting it from the current tree does not remove old commits.

Back up the private history outside the publication path, coordinate any rewrite with collaborators, scan the resulting refs, and update the parent submodule references. Review branches, tags, release attachments, cached PR diffs and author metadata as well as the current tree.

## Private files

Keep these out of source control:

- Source PDFs, employer/client documents, private plans and `.private/` backups.
- Terraform state, saved plans, populated backend profiles and tfvars.
- Credentials, signing keys, secret JSON, `.env` files, database dumps and logs.
- Operational hostnames, account details, private captures and real customer data.

Example profiles, synthetic fixtures and public dependency digests can remain in source. Run a secret scanner and review the staged diff before publication, including each submodule.

## GitHub configuration

Run public PRs on GitHub-hosted runners without deployment credentials. Restrict publication to trusted main-branch pushes and deployment to the protected environment. Keep fork code off the shared self-hosted runner, and review Actions logs and artifact access.

Choose a license only for material you have the right to license. History cleanup and repository visibility changes require separate action; this guide does not perform either.
