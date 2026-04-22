# Changelog

All notable changes to this project will be documented here. Releases are
produced by `.github/workflows/release.yml` when triggered manually with a
target version.

## Unreleased

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
