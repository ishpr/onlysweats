const { withEntitlementsPlist, withInfoPlist } = require("expo/config-plugins");

module.exports = function withHealthKit(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.NSHealthShareUsageDescription =
      "With your permission, SamePace reads the Apple Health data you choose and syncs it to your private SamePace account for workout history and summaries.";
    return mod;
  });
  return withEntitlementsPlist(config, (mod) => {
    mod.modResults["com.apple.developer.healthkit"] = true;
    mod.modResults["com.apple.developer.healthkit.background-delivery"] = true;
    return mod;
  });
};
