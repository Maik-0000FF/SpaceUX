<!--
SPDX-FileCopyrightText: Maik-0000FF
SPDX-License-Identifier: GPL-3.0-or-later
-->

# Third-party licenses

SpaceUX bundles the fonts below as its default typefaces (the pie labels and,
via the shared stacks in `src/core/typography.css`, the editor UI). Each is
distributed under the SIL Open Font License, Version 1.1 (OFL-1.1).

The full license text ships with the application under `licenses/` (copied
from each package at build time by `scripts/copy-font-licenses.mjs`) and is
also available in each package under
`node_modules/@fontsource-variable/*/LICENSE`.

| Font           | Copyright                                                                              | License     |
| -------------- | -------------------------------------------------------------------------------------- | ----------- |
| Inter          | © 2016 The Inter Project Authors (https://github.com/rsms/inter)                       | SIL OFL-1.1 |
| JetBrains Mono | © 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) | SIL OFL-1.1 |

Choosing a System or Custom font in the editor (issue #237) does not change
these obligations: the bundled files still ship as the fallback default.
