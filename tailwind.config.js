/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: 'rgb(var(--surface) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        mute: 'rgb(var(--mute) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        pink: { DEFAULT: '#ff4f8b', dark: '#d92a68', soft: 'rgb(var(--pink-soft) / <alpha-value>)' },
        orange: { DEFAULT: '#ff9f1c', soft: 'rgb(var(--orange-soft) / <alpha-value>)' },
        sun: { DEFAULT: '#ffd23f', soft: 'rgb(var(--sun-soft) / <alpha-value>)' },
        mint: { DEFAULT: '#14b8a6', dark: '#0f8f82', soft: 'rgb(var(--mint-soft) / <alpha-value>)' },
        sky: { DEFAULT: '#3a86ff', soft: 'rgb(var(--sky-soft) / <alpha-value>)' },
        grape: { DEFAULT: '#8e5cf7', soft: 'rgb(var(--grape-soft) / <alpha-value>)' },
      },
      fontFamily: { sans: ['"Nunito Variable"', 'ui-rounded', 'system-ui', 'sans-serif'] },
      borderRadius: { '2xl': '1.25rem', '3xl': '1.75rem' },
      boxShadow: { pop: '0 6px 20px -6px rgb(255 79 139 / 0.45)', card: '0 2px 12px -4px rgb(0 0 0 / 0.12)' },
    },
  },
  plugins: [],
}
