module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // react-native-worklets powers Reanimated 4 — this plugin MUST stay last.
    plugins: ['react-native-worklets/plugin'],
  };
};
