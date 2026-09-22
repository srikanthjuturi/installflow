const expoConfig = require('eslint-config-expo/flat');

/**
 * Words on screen live in src/i18n/locales/en.json and reach a screen through
 * t(), so that every language can replace them. These catch English written
 * straight into a component again: text between tags, a string that is a JSX
 * child (or either branch of a ?: or the right of &&), the props a person
 * always reads, and Alert.alert's own title and body.
 *
 * "Two letters in a row" is the test, so the punctuation and numbers screens
 * are built from — "·", "—", "₹", "+91", "98765 43210" — still pass.
 *
 * They sit in the SAME no-restricted-syntax list as the colour rules below.
 * A second config object setting that rule for these files would REPLACE the
 * colour selectors, not add to them.
 */
const WORDS = '/[A-Za-z][A-Za-z]/';
const COPY_PROPS =
  '/^(title|label|placeholder|body|hint|disabledHint|message|error|eyebrow|subtitle|accessibilityLabel|accessibilityHint)$/';
const COPY_MESSAGE =
  'Put words on screen in src/i18n/locales/en.json and render them with t(). See src/i18n/README.md.';
const copy = (selector) => ({ selector, message: COPY_MESSAGE });
const CHILD = 'JSXExpressionContainer[parent.type=/^JSX(Element|Fragment)$/]';
const PROP = `JSXAttribute[name.name=${COPY_PROPS}]`;
const ALERT = "CallExpression[callee.object.name='Alert'][callee.property.name='alert']";
const COPY_SELECTORS = [
  copy(`JSXText[value=${WORDS}]`),
  copy(`${CHILD} > Literal[value=${WORDS}]`),
  copy(`${CHILD} > ConditionalExpression > Literal[value=${WORDS}]`),
  copy(`${CHILD} > LogicalExpression > Literal[value=${WORDS}]`),
  copy(`${CHILD} > TemplateLiteral > TemplateElement[value.raw=${WORDS}]`),
  copy(`${PROP} > Literal[value=${WORDS}]`),
  copy(`${PROP} > JSXExpressionContainer > Literal[value=${WORDS}]`),
  copy(`${PROP} > JSXExpressionContainer > ConditionalExpression > Literal[value=${WORDS}]`),
  copy(`${PROP} > JSXExpressionContainer > TemplateLiteral > TemplateElement[value.raw=${WORDS}]`),
  copy(`${ALERT} > Literal[value=${WORDS}]`),
  copy(`${ALERT} > TemplateLiteral > TemplateElement[value.raw=${WORDS}]`),
];

/**
 * The no-hardcoded-colour rule below is the enforcement half of the design
 * token system. Without it, "use tokens" is a convention people forget;
 * with it, a stray `#1f6feb` fails CI.
 *
 * src/theme/** is exempt — that's where colours are supposed to live.
 * app.json is exempt — the Expo CLI reads it before Metro, so it can't import
 * tokens (and ESLint does not lint JSON anyway).
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
        ...COPY_SELECTORS,
      ],
      // Every screen draws text through ui/Text, which gives Hindi, Telugu,
      // Kannada and Tamil the line height they need. React Native's own Text
      // would skip that, and nothing on an English screen would show it.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['Text'],
              message:
                'Import Text from @/components/ui — it adjusts Indian scripts. See src/components/ui/Text.tsx.',
            },
          ],
        },
      ],
    },
  },
  {
    // The one place that wraps React Native's Text.
    files: ['src/components/ui/Text.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
];
