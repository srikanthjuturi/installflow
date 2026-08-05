const { palette } = require('./src/theme/tokens');

/**
 * Colours come from src/theme/tokens.js — the SAME file app code imports.
 * Never add a colour here; add it there.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: palette.primary,
        secondary: palette.secondary,
        success: palette.success,
        danger: palette.danger,
        neutral: palette.neutral,
        chrome: palette.chrome,
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '14px',
        xl: '16px',
        '2xl': '18px',
        full: '999px',
      },
      fontFamily: {
        sans: ['Roboto_400Regular'],
        medium: ['Roboto_500Medium'],
        bold: ['Roboto_700Bold'],
        black: ['Roboto_900Black'],
      },
    },
  },
  plugins: [],
};
