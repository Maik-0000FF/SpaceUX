<!--
SPDX-FileCopyrightText: Maik-0000FF
SPDX-License-Identifier: GPL-3.0-or-later
-->

# Third-party licenses

SpaceUX bundles the font below as the pie labels' default typeface
(`src/qt-shared/fonts/Inter-SemiBold.ttf`, rendered by the live overlay and the
editor preview; the editor UI itself uses the desktop's system font). It is
distributed under the SIL Open Font License, Version 1.1 (OFL-1.1); the full
license text is in the repository at `LICENSES/OFL-1.1.txt` and ships with the
source checkout the launcher runs from.

| Font  | Copyright                                                        | License     |
| ----- | ---------------------------------------------------------------- | ----------- |
| Inter | © 2016 The Inter Project Authors (https://github.com/rsms/inter) | SIL OFL-1.1 |

Choosing a System or Custom font in the editor (issue #237) does not change
these obligations: the bundled file still ships as the fallback default.

## Graphics

SpaceUX bundles one Twemoji graphic as the first-run showcase pie centre (the
waving-hand emoji, U+1F44B, at `assets/emoji/1f44b.svg`). It is rendered as a
vector so the native overlay centre stays crisp instead of a system emoji-font
glyph (issue #403).

| Graphic                | Copyright                                                                  | License   |
| ---------------------- | -------------------------------------------------------------------------- | --------- |
| Twemoji waving hand 👋 | © Twitter, Inc and other contributors (https://github.com/jdecked/twemoji) | CC-BY-4.0 |

Twemoji graphics are licensed under CC-BY 4.0
(https://creativecommons.org/licenses/by/4.0/).
