const expoConfig = require('eslint-config-expo/flat');

/**
 * The no-hardcoded-colour rule below is the enforcement half of the design
 * token system. Without it, "use tokens" is a convention people forget;
 * with it, a stray `#1f6feb` fails CI.
 *
 * src/theme/** is exempt — that's where colours are supposed to live.
 * app.config.ts is exempt — it runs before Metro, so it can't import tokens.
 */
module.exports = [
  ...expoConfig,
  {
    // appdesign holds the approved prototype — a bundled artifact, not source.
    ignores: ['dist/*', '.expo/*', 'node_modules/*', 'appdesign/*'],
  },
  {
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    ignores: ['src/theme/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}){1,2}$/]',
          message:
            'No hex colours outside src/theme. Import `color` from @/theme/semantic, or use a NativeWind class.',
        },
        {
          selector: 'Literal[value=/^(rgb|hsl)a?\\(/]',
          message:
            'No raw colour functions outside src/theme. Import `color` from @/theme/semantic.',
        },
      ],
    },
  },
];
