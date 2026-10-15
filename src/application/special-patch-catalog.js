const { normalizeMod, validateSpecialPatch } = require('../core/models');
const bundledEntries = require('./special-patches.json');

const SPECIAL_PATCH_CATALOG = bundledEntries
  .map(normalizeMod)
  .filter((mod) => mod.modType === 'special_patch' && validateSpecialPatch(mod));

module.exports = { SPECIAL_PATCH_CATALOG };
