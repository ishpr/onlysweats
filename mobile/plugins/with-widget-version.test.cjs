const assert = require("node:assert/strict");
const test = require("node:test");
const plist = require("@expo/plist").default;
const { completeWidgetInfo } = require("./with-widget-version");

test("widget source plist retains remote versions and extension identity without generation", () => {
  const source = {
    CFBundleVersion: "87",
    CFBundleShortVersionString: "2.4.1",
    NSExtension: { NSExtensionPointIdentifier: "com.apple.widgetkit-extension" },
    ExpoWidgetsAppGroupIdentifier: "group.app.samepace",
  };
  const result = JSON.parse(JSON.stringify(plist.parse(plist.build(completeWidgetInfo(source)))));
  assert.equal(result.CFBundleVersion, "87");
  assert.equal(result.CFBundleShortVersionString, "2.4.1");
  assert.equal(result.CFBundlePackageType, "XPC!");
  assert.equal(result.CFBundleExecutable, "$(EXECUTABLE_NAME)");
  assert.equal(result.CFBundleIdentifier, "$(PRODUCT_BUNDLE_IDENTIFIER)");
  assert.deepEqual(result.NSExtension, source.NSExtension);
  assert.equal(result.ExpoWidgetsAppGroupIdentifier, "group.app.samepace");
  assert.deepEqual(completeWidgetInfo(result), result);
});
