const fs = require("node:fs");
const path = require("node:path");
const plist = require("@expo/plist").default;
const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");

const TARGET = "ExpoWidgetsTarget";

// EAS applies its remote build number to each target's source Info.plist after
// prebuild. Xcode's generated plist otherwise replaces that value with the
// widget plugin's default CURRENT_PROJECT_VERSION (1). Use a complete source
// plist so the final extension keeps the same version as its containing app.
module.exports = function withWidgetVersion(config) {
  config = withDangerousMod(config, ["ios", async (mod) => {
    const filename = path.join(mod.modRequest.platformProjectRoot, TARGET, "Info.plist");
    const info = plist.parse(fs.readFileSync(filename, "utf8"));
    fs.writeFileSync(filename, plist.build(completeWidgetInfo(info)));
    return mod;
  }]);
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const target = Object.entries(project.pbxNativeTargetSection()).find(
      ([key, value]) => !key.endsWith("_comment") && value.name?.replaceAll('"', "") === TARGET,
    )?.[1];
    if (!target) throw new Error("SamePace widget target is missing.");
    const list = project.pbxXCConfigurationList()[target.buildConfigurationList];
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const { value } of list.buildConfigurations) {
      configurations[value].buildSettings.GENERATE_INFOPLIST_FILE = "NO";
    }
    return mod;
  });
};

function completeWidgetInfo(info) {
  return {
    CFBundleDevelopmentRegion: "$(DEVELOPMENT_LANGUAGE)",
    CFBundleDisplayName: "SamePace",
    CFBundleExecutable: "$(EXECUTABLE_NAME)",
    CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundleName: "$(PRODUCT_NAME)",
    CFBundlePackageType: "XPC!",
    ...info,
  };
}

module.exports.completeWidgetInfo = completeWidgetInfo;
