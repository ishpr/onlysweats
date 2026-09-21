const fs = require("node:fs");
const path = require("node:path");
const { withXcodeProject, withDangerousMod } = require("expo/config-plugins");
const plist = require("@expo/plist").default;

const TARGET = "SamePaceWatch";
const FILES = ["SamePaceWatchApp.swift", "WorkoutRecorder.swift", "ZoneCue.swift"];

/** Reproducible single-target SwiftUI watchOS companion, independent of CocoaPods. */
module.exports = function withWatch(config) {
  const phoneBundle = config.ios?.bundleIdentifier;
  if (!phoneBundle) throw new Error("SamePace Watch needs an iOS bundle identifier.");
  const bundle = `${phoneBundle}.watchkitapp`;
  const entitlement = { "com.apple.developer.healthkit": true };
  const existing = config.extra?.eas?.build?.experimental?.ios?.appExtensions ?? [];
  config.extra = {
    ...config.extra,
    eas: {
      ...config.extra?.eas,
      build: {
        ...config.extra?.eas?.build,
        experimental: {
          ...config.extra?.eas?.build?.experimental,
          ios: {
            ...config.extra?.eas?.build?.experimental?.ios,
            appExtensions: [
              ...existing.filter((entry) => entry.targetName !== TARGET),
              { targetName: TARGET, bundleIdentifier: bundle, entitlements: entitlement },
            ],
          },
        },
      },
    },
  };
  config = withDangerousMod(config, [
    "ios",
    async (mod) => {
      writeFiles(
        mod.modRequest.projectRoot,
        mod.modRequest.platformProjectRoot,
        phoneBundle,
        config.version ?? "1.0.0",
        config.ios?.buildNumber ?? "1",
      );
      return mod;
    },
  ]);
  return withXcodeProject(config, (mod) => {
    configureTarget(mod.modResults, {
      bundle,
      team: config.ios?.appleTeamId,
      version: config.version ?? "1.0.0",
      buildNumber: config.ios?.buildNumber ?? "1",
    });
    return mod;
  });
};

function writeFiles(projectRoot, iosRoot, phoneBundle, version, buildNumber) {
  const source = path.join(projectRoot, "watch", TARGET);
  const target = path.join(iosRoot, TARGET);
  fs.mkdirSync(target, { recursive: true });
  for (const filename of FILES)
    fs.copyFileSync(path.join(source, filename), path.join(target, filename));
  const info = {
    CFBundleDisplayName: "SamePace",
    CFBundleName: "$(PRODUCT_NAME)",
    CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
    CFBundleExecutable: "$(EXECUTABLE_NAME)",
    CFBundlePackageType: "APPL",
    CFBundleShortVersionString: version,
    CFBundleVersion: buildNumber,
    WKApplication: true,
    WKCompanionAppBundleIdentifier: phoneBundle,
    WKRunsIndependentlyOfCompanionApp: false,
    WKBackgroundModes: ["workout-processing"],
    NSHealthShareUsageDescription:
      "SamePace reads workout measurements and your Health zone settings to display your recording and optional zone cues.",
    NSHealthUpdateUsageDescription:
      "SamePace saves workouts you choose to record to Apple Health so they can sync to your iPhone.",
    ITSAppUsesNonExemptEncryption: false,
  };
  fs.writeFileSync(path.join(target, "Info.plist"), plist.build(info));
  fs.writeFileSync(
    path.join(target, `${TARGET}.entitlements`),
    plist.build({ "com.apple.developer.healthkit": true }),
  );
  const assets = path.join(target, "Assets.xcassets");
  const icons = path.join(assets, "AppIcon.appiconset");
  fs.mkdirSync(icons, { recursive: true });
  fs.writeFileSync(
    path.join(assets, "Contents.json"),
    JSON.stringify({ info: { version: 1, author: "xcode" } }),
  );
  fs.copyFileSync(path.join(projectRoot, "assets/images/icon.png"), path.join(icons, "icon.png"));
  fs.writeFileSync(
    path.join(icons, "Contents.json"),
    JSON.stringify({
      images: [
        { idiom: "universal", platform: "watchos", size: "1024x1024", filename: "icon.png" },
      ],
      info: { author: "xcode", version: 1 },
    }),
  );
}

function configureTarget(project, options) {
  // node-xcode silently skips dependencies when these sections are absent in a
  // fresh Expo project. Initialize both, then also repair existing targets.
  project.hash.project.objects.PBXTargetDependency ??= {};
  project.hash.project.objects.PBXContainerItemProxy ??= {};
  const targets = project.pbxNativeTargetSection();
  let entry = Object.entries(targets).find(
    ([key, value]) => !key.endsWith("_comment") && value.name?.replaceAll('"', "") === TARGET,
  );
  if (!entry) {
    const target = project.addTarget(TARGET, "application", TARGET, options.bundle);
    entry = [target.uuid, target.pbxNativeTarget];
    const group = project.addPbxGroup([], TARGET, TARGET);
    project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
    project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
    for (const filename of FILES)
      project.addSourceFile(filename, { target: target.uuid }, group.uuid);
    if (!project.pbxGroupByName("Resources")) {
      const resources = project.addPbxGroup([], "Resources");
      project.addToPbxGroup(resources.uuid, project.getFirstProject().firstProject.mainGroup);
    }
    project.addResourceFile("Assets.xcassets", { target: target.uuid }, group.uuid);
    project.addBuildPhase(
      [`${TARGET}.app`],
      "PBXCopyFilesBuildPhase",
      "Embed Watch Content",
      project.getFirstTarget().uuid,
      "watch2_app",
      '"$(CONTENTS_FOLDER_PATH)/Watch"',
    );
  }
  const [uuid, target] = entry;
  const main = project.getFirstTarget();
  const dependencies = project.hash.project.objects.PBXTargetDependency;
  if (
    !main.firstTarget.dependencies.some(
      (dependency) => dependencies[dependency.value]?.target === uuid,
    )
  ) {
    project.addTargetDependency(main.uuid, [uuid]);
  }
  const list = project.pbxXCConfigurationList()[target.buildConfigurationList];
  const configurations = project.pbxXCBuildConfigurationSection();
  for (const { value } of list.buildConfigurations) {
    Object.assign(configurations[value].buildSettings, {
      PRODUCT_BUNDLE_IDENTIFIER: options.bundle,
      PRODUCT_NAME: TARGET,
      SDKROOT: "watchos",
      SUPPORTED_PLATFORMS: '"watchos watchsimulator"',
      WATCHOS_DEPLOYMENT_TARGET: "10.0",
      TARGETED_DEVICE_FAMILY: "4",
      SWIFT_VERSION: "5.9",
      SWIFT_EMIT_LOC_STRINGS: "YES",
      INFOPLIST_FILE: `${TARGET}/Info.plist`,
      CODE_SIGN_ENTITLEMENTS: `${TARGET}/${TARGET}.entitlements`,
      GENERATE_INFOPLIST_FILE: "NO",
      CODE_SIGN_STYLE: "Automatic",
      CURRENT_PROJECT_VERSION: options.buildNumber,
      MARKETING_VERSION: options.version,
      ASSETCATALOG_COMPILER_APPICON_NAME: "AppIcon",
      LD_RUNPATH_SEARCH_PATHS: '"$(inherited) @executable_path/Frameworks"',
      SKIP_INSTALL: "YES",
      ...(options.team ? { DEVELOPMENT_TEAM: options.team } : {}),
    });
  }
  project.addTargetAttribute("SystemCapabilities", { "com.apple.HealthKit": { enabled: 1 } }, uuid);
}
module.exports.configureTarget = configureTarget;
module.exports.writeFiles = writeFiles;
