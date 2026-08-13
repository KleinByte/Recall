# Contributing to Recall

Thank you for helping improve Recall.

## Contributor agreement

All contributors must read and accept the [Recall Contributor License Agreement](CLA.md) before a pull request can be merged. The agreement lets you keep ownership of your contribution while giving the project owner the rights needed to distribute Recall under its public noncommercial license and under separate commercial or proprietary terms.

For an individual contribution, affirm the contributor-agreement checkbox in the pull-request template. If an employer or another organization owns or controls your contribution, do not submit it until an authorized representative has accepted the agreement on that organization's behalf. Contact KleinByte through [GitHub](https://github.com/KleinByte) to arrange entity acceptance.

Do not submit third-party code, assets, data, or other material unless you identify it and its license in the pull request and that license is compatible with Recall's licensing.

## Development workflow

1. Create a focused branch and keep unrelated changes out of the pull request.
2. Explain the user-facing effect and implementation in the pull-request description.
3. Add or update tests for behavioral changes.
4. Run `pnpm verify` before requesting review.

Depending on the change, the maintainers may also ask for `pnpm test:e2e` or a package smoke test.

