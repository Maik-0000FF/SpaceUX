// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

// The ONE home of the editor's node-path helpers. Paths address a node in the
// menu tree as a "/"-joined index string ("" = the root/centre, "/0/1" = the
// node at root.branches[0].branches[1]); the core methods want the same path
// as an index array. Main (selection/view paths) and NodeTree (rows, move
// bookkeeping) both convert constantly, so the conversions live once here.
// (No `.pragma library`: it isn't standard JS, so the JS toolchain can't parse
// it, and these are stateless functions; per-importer evaluation is fine.)

/** The path of the node's parent ring ("" for a top-level node and the root). */
function parentPath(path) {
  const at = path.lastIndexOf('/');
  return at <= 0 ? '' : path.slice(0, at);
}

/** The node's index within its ring (the path's last segment). */
function lastIndex(path) {
  return parseInt(path.slice(path.lastIndexOf('/') + 1));
}

/** The path of `index` inside the ring at `path`. */
function childPath(path, index) {
  return path + '/' + index;
}

/** Path string -> index array ("" -> []). */
function toIndices(path) {
  return path
    .split('/')
    .filter(function (p) {
      return p.length > 0;
    })
    .map(function (p) {
      return parseInt(p);
    });
}

/** Index array -> path string ([] -> ""). */
function toPath(indices) {
  return indices.length === 0 ? '' : '/' + indices.join('/');
}

/** `prefix` is a (non-strict) prefix of `arr` (index arrays). Mirrors the
 *  core's `isPrefix` (core/menu-edit.ts), which QML cannot import. */
function isIndexPrefix(prefix, arr) {
  if (prefix.length > arr.length) return false;

  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== arr[i]) return false;
  }
  return true;
}
