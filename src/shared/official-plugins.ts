// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Content hashes of the official first-party plugins (from the SpaceUX-plugins
 * repo). The "Verified" badge requires a plugin's on-disk content to match the
 * hash here (see pluginTrust in main/plugin-hash), not just its id, so an
 * imported plugin that merely claims an official id is never marked verified.
 *
 * The hash is a sha256 over the plugin directory (see hashPluginDir). Regenerate
 * these entries whenever an official plugin's content changes, otherwise the
 * genuine plugin stops verifying.
 */
export const OFFICIAL_PLUGIN_HASHES: ReadonlyMap<string, string> = new Map([
  [
    'org.spaceux.example-launch',
    'dcd0dd6da49fa2c95a537a0254774a92d6ffc1add0447949e20f5cf1b7c14a56',
  ],
  ['org.spaceux.freecad', '4099906424091fc4fc6f44d2d8c69b22a5c2a78a148881dcf30d774017108a0c'],
  [
    'org.spaceux.twist-press-lift',
    '086c714735ce65a816e37b721e2c2641dbeb53c4dd0ef05f913f1e44a9d44063',
  ],
  ['org.spaceux.planets', 'e350a92759b51da87083bc6c20e73da16012310bf2c753c11b34d99de2c51b0c'],
]);

/** The expected content hash for an official plugin id, or undefined when the id
 *  is not an official plugin. */
export function expectedOfficialHash(id: string): string | undefined {
  return OFFICIAL_PLUGIN_HASHES.get(id);
}
