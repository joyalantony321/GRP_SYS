/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Poppins', 'sans-serif'],
      },
      colors: {
        active: {
          light: '#fee2e2',
          DEFAULT: '#ef4444',
        },
        pending: {
          light: '#fef3c7',
          DEFAULT: '#f59e0b',
        },
        inactive: {
          light: '#dbeafe',
          DEFAULT: '#3b82f6',
        },
      },
    },
  },
  plugins: [],
}
