const { withAndroidStyles } = require("expo/config-plugins");

module.exports = function withCompactAndroidTabs(config) {
  return withAndroidStyles(config, (mod) => {
    const resources = mod.modResults.resources;
    // Material 3 adds the system navigation inset separately.
    const tabDimensions = {
      m3_bottom_nav_item_padding_bottom: "4dp",
      m3_bottom_nav_min_height: "68dp",
    };
    resources.dimen = [
      ...(resources.dimen ?? []).filter(({ $ }) => !Object.hasOwn(tabDimensions, $.name)),
      ...Object.entries(tabDimensions).map(([name, value]) => ({ $: { name }, _: value })),
    ];
    return mod;
  });
};
