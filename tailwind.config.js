/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        brand: { 50: '#f6f3ee', 100: '#ebe3d6', 200: '#d8c6aa', 300: '#c2a47a', 400: '#ad8656', 500: '#946c3e', 600: '#7a5632', 700: '#5f422a', 800: '#4a3423', 900: '#33241a' },
        pine: { 50: '#eef7f2', 100: '#d6ece0', 500: '#2f7a55', 600: '#256546', 700: '#1d4f37' },
      },
    },
  },
  plugins: [],
}
