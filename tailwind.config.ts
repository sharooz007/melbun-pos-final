import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas-base)",
        surface: "var(--pure-surface)",
        ink: {
          primary: "var(--ink-primary)",
          muted: "var(--ink-muted)",
        },
        border: "var(--border-default)",
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
        },
        "row-alt": "var(--row-alt)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)"],
        mono: ["var(--font-geist-mono)"],
      },
      keyframes: {
        scan: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(calc(100% + 150px))' },
        }
      },
      animation: {
        scan: 'scan 2s ease-in-out infinite',
      }
    },
  },
  plugins: [],
};
export default config;
