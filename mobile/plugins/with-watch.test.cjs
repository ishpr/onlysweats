const assert = require("node:assert/strict");
const test = require("node:test");
const xcode = require("xcode");
const { configureTarget } = require("./with-watch");

function freshProject() {
  const project = xcode.project("memory.pbxproj");
  project.hash = {
    project: {
      rootObject: "PROJECT",
      rootObject_comment: "Project object",
      objects: {
        PBXProject: {
          PROJECT: {
            isa: "PBXProject",
            mainGroup: "MAIN",
            attributes: {},
            targets: [{ value: "PHONE", comment: "SamePace" }],
          },
        },
        PBXNativeTarget: {
          PHONE: { isa: "PBXNativeTarget", name: "SamePace", dependencies: [], buildPhases: [] },
        },
        PBXGroup: {
          MAIN: {
            isa: "PBXGroup",
            children: [{ value: "PRODUCTS", comment: "Products" }],
            sourceTree: '"<group>"',
          },
          PRODUCTS: { isa: "PBXGroup", name: "Products", children: [], sourceTree: '"<group>"' },
          PRODUCTS_comment: "Products",
        },
        PBXFileReference: {},
        PBXBuildFile: {},
        XCBuildConfiguration: {},
        XCConfigurationList: {},
        PBXSourcesBuildPhase: {},
        PBXResourcesBuildPhase: {},
        PBXFrameworksBuildPhase: {},
        // Fresh Expo projects do not have dependency or proxy sections yet.
      },
    },
  };
  return project;
}
const options = { bundle: "app.example.watchkitapp", version: "1.0.0", buildNumber: "1" };
function watchTarget(project) {
  return Object.entries(project.pbxNativeTargetSection()).find(
    ([key, value]) =>
      !key.endsWith("_comment") && value.name?.replaceAll('"', "") === "SamePaceWatch",
  );
}
function watchDependencies(project) {
  return project
    .getFirstTarget()
    .firstTarget.dependencies.filter(
      ({ value }) =>
        project.hash.project.objects.PBXTargetDependency[value]?.target === watchTarget(project)[0],
    );
}

test("fresh projects build the embedded Watch target and repeated prebuild stays idempotent", () => {
  const project = freshProject();
  configureTarget(project, options);
  configureTarget(project, options);
  assert.equal(watchDependencies(project).length, 1);
  assert.equal(
    Object.entries(project.pbxNativeTargetSection()).filter(([key]) => !key.endsWith("_comment"))
      .length,
    2,
  );
  const target = watchTarget(project)[1];
  assert.equal(target.buildPhases.length, 3);
  const list = project.pbxXCConfigurationList()[target.buildConfigurationList];
  for (const config of list.buildConfigurations) {
    const settings = project.pbxXCBuildConfigurationSection()[config.value].buildSettings;
    assert.equal(settings.SDKROOT, "watchos");
    assert.equal(settings.PRODUCT_BUNDLE_IDENTIFIER, options.bundle);
  }
});

test("reapplying repairs an existing target that lacks its host dependency", () => {
  const project = freshProject();
  configureTarget(project, options);
  project.getFirstTarget().firstTarget.dependencies = [];
  configureTarget(project, options);
  assert.equal(watchDependencies(project).length, 1);
});
