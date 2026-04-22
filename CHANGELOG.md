# Changelog

All notable changes to this project will be documented here. Automated
releases are produced by `.github/workflows/release.yml` on every push to
`main` that touches the extension source.

## Unreleased

- (changes here before the next release)

## v0.1.0 — 2026-04-22

- Initial version.
- Per-duration rules with configurable side (start or end) and shortening
  amount.
- Toolbar popup for editing rules.
- Override handling: the extension respects a manual revert to the original
  matching duration; later deviations through a non-matching duration reset
  the memory so a fresh match re-applies.
- DOM-robust write path using `focus` + `execCommand("insertText")` (guarded
  on `document.activeElement`) with Enter/blur commit, and verify-retry on
  each input to survive GCal's dialog initialisation race.
