/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                neon: {
                    blue: '#00f3ff',
                    purple: '#bc13fe',
                    green: '#0aff00',
                    dark: '#0a0a0a',
                    surface: '#121212'
                }
            },
            fontFamily: {
                mono: ['"Fira Code"', 'monospace'],
                sans: ['"Inter"', 'sans-serif']
            },
            boxShadow: {
                'neon-blue': '0 0 10px #00f3ff, 0 0 20px #00f3ff',
                'neon-purple': '0 0 10px #bc13fe, 0 0 20px #bc13fe',
            }
        },
    },
    plugins: [],
}
