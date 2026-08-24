export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        lga: {
          navy: '#003B5C',
          blue: '#005A8B',
          sky: '#007EA8',
          teal: '#007C83',
          gold: '#F2C94C',
          red: '#C83349',
        },
        primary: {
          50: '#EDF7FA',
          100: '#D4EBF2',
          200: '#A9D7E5',
          300: '#75BDD3',
          400: '#399BBB',
          500: '#007EA8',
          600: '#006A91',
          700: '#005A7A',
          800: '#004A65',
          900: '#003B5C',
          950: '#00263D',
        },
        accent: {
          50: '#FFFBEA',
          100: '#FFF4C5',
          200: '#FDE98A',
          300: '#F8D957',
          400: '#F2C94C',
          500: '#D9A514',
          600: '#AD7C08',
          700: '#835B0B',
          800: '#6B4910',
          900: '#5B3D12',
          950: '#352006',
        },
        success: {
          DEFAULT: '#16734A',
          light: '#E7F5ED',
          dark: '#0D5234',
        },
        warning: {
          DEFAULT: '#9A6700',
          light: '#FFF4CE',
          dark: '#663C00',
        },
        danger: {
          DEFAULT: '#B42335',
          light: '#FDECEF',
          dark: '#7A1624',
        },
        info: {
          DEFAULT: '#005A8B',
          light: '#E6F3F8',
          dark: '#003B5C',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          muted: '#F4F7F9',
          subtle: '#E6ECF0',
          inverse: '#172B3A',
        },
        text: {
          DEFAULT: '#172B3A',
          muted: '#4B5F6D',
          inverse: '#FFFFFF',
          link: '#005A8B',
        },
        border: {
          DEFAULT: '#B8C5CD',
          strong: '#687C89',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'Arial',
          'Helvetica Neue',
          'Helvetica',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 2px 8px rgba(0, 59, 92, 0.12)',
        elevated: '0 8px 24px rgba(0, 59, 92, 0.18)',
        focus: '0 0 0 3px rgba(0, 126, 168, 0.35)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
};