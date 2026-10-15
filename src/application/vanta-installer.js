class VantaInstaller {
  constructor({ modManager, diagnostics }) {
    this.modManager = modManager;
    this.diagnostics = diagnostics;
  }

  importVpk(filePath, metadata = {}) {
    return this.modManager.importVpk(filePath, metadata.name || metadata.displayName, metadata);
  }

  installPackage(mod, packagePath, source = {}) {
    return this.modManager.installFromPackage(mod, packagePath, source);
  }

  setEnabled(id, enabled) { return this.modManager.setEnabled(id, enabled); }
  update(id) { return this.modManager.updateFromLibrary(id); }
  uninstall(id) { return this.modManager.uninstall(id); }
  repair(id) { return this.modManager.repair(id); }
  reorder(ids) { return this.modManager.reorder(ids); }
}

module.exports = { VantaInstaller };
