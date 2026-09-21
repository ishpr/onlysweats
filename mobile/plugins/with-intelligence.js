const fs = require("node:fs");
const path = require("node:path");
const { withXcodeProject, withEntitlementsPlist, IOSConfig } = require("expo/config-plugins");

/** The AppIntents metadata processor must see shortcuts in the application
 * target; a Swift file hidden inside a CocoaPod is insufficient for discovery. */
module.exports = function withIntelligence(config) {
  config = withEntitlementsPlist(config, (mod) => {
    const groups = mod.modResults["com.apple.security.application-groups"] ?? [];
    mod.modResults["com.apple.security.application-groups"] = [
      ...new Set([...groups, "group.app.samepace"]),
    ];
    return mod;
  });
  return withXcodeProject(config, (mod) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(mod.modRequest.projectRoot);
    const relative = `${projectName}/SamePaceShortcuts.swift`;
    const destination = path.join(mod.modRequest.platformProjectRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(
      path.join(
        mod.modRequest.projectRoot,
        "modules/samepace-intelligence/shortcuts/SamePaceShortcuts.swift",
      ),
      destination,
    );
    const target = IOSConfig.XcodeUtils.getApplicationNativeTarget({
      project: mod.modResults,
      projectName,
    });
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: relative,
      groupName: projectName,
      project: mod.modResults,
      targetUuid: target.uuid,
    });
    return mod;
  });
};
