// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The transport-agnostic editor <-> core service (#457, Phase A2): one function
 * per A1 contract method, DERIVED from {@link CoreMethods} so the service surface
 * and the D-Bus contract cannot drift. There is a single implementation of the
 * editor's service logic, hosted by the headless `org.spaceux.Core1` D-Bus
 * server. A method may be sync or async; callers `await` either way.
 */

import type { CoreMethods } from '../shared/core-contract.js';

export type CoreService = {
  [K in keyof CoreMethods]: (
    ...args: CoreMethods[K]['args']
  ) => CoreMethods[K]['result'] | Promise<CoreMethods[K]['result']>;
};

/**
 * The device + per-device-profile slice of the core service (#113): the
 * connected-device snapshot and the saved-profile management (list / override /
 * save / delete). The implementation closes over the core entry's live device +
 * profile state, so it is built there (core-service-builder.ts).
 */
export type ProfileCoreService = Pick<
  CoreService,
  'GetDeviceInfo' | 'GetProfiles' | 'SetProfileOverride' | 'SaveProfile' | 'DeleteProfile'
>;

// The service surface is built slice by slice as `Pick<CoreService, ...>` (app,
// editor, device/profile). The full-coverage check, that every CoreMethod has an
// implementation, is the D-Bus server assembling the slices into one CoreService
// (core-service-builder.ts, whose return-type annotation is the completeness
// gate).
