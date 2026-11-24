/** @type {import('tailwindcss').Config} */
// Brand colors come from CSS variables (see src/index.css) so a deployment can
// re-theme the app from its company config without rebuilding.
const shade = (n) => `rgb(var(--brand-${n}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: shade(50),
          100: shade(100),
          200: shade(200),
          300: shade(300),
          400: shade(400),
          500: shade(500),
          600: shade(600),
          700: shade(700),
          800: shade(800),
          900: shade(900),
        },
      },
    },
  },
  plugins: [],
};
