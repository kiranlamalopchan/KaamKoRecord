jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
// Folds and list entrances animate with reanimated, whose native side does
// not exist under jest: its own mocks stand in, for every test that renders one.
jest.mock("react-native-worklets", () => require("react-native-worklets/src/mock"));
jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));
// Swipe-to-reply and swipeable chat rows use gesture-handler, whose native side
// is replaced here by the library's own mocks.
require("react-native-gesture-handler/jestSetup");
