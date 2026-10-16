/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        basalt: "var(--bg-basalt)",
        surface: {
          DEFAULT: "var(--bg-surface)",
          raised: "var(--bg-surface-raised)",
        },
        hairline: "var(--border-hairline)",
        bone: "var(--text-bone)",
        subtle: "var(--text-muted)",
        ember: {
          DEFAULT: "var(--signal-ember)",
          glow: "var(--signal-ember-glow)",
        },
        lichen: "var(--signal-lichen)",
        ochre: "var(--signal-ochre)",
        ink: "var(--trace-ink)",

        // Mappings for existing component compatibility
        background: "var(--bg-basalt)",
        sidebar: "var(--bg-surface)",
        panel: "var(--bg-surface)",
        elevated: "var(--bg-surface-raised)",
        border: "var(--border-hairline)",
        foreground: "var(--text-bone)",
        muted: "var(--text-muted)",
        accent: {
          blue: "var(--signal-ember)",
          violet: "var(--signal-ochre)",
        },
        status: {
          success: "var(--signal-lichen)",
          warning: "var(--signal-ochre)",
          failure: "var(--signal-ember)",
        },
        epicenter: "var(--signal-ember-glow)",
      },
      fontFamily: {
        display: ["Instrument Serif", "Georgia", "serif"],
        sans: ["Hanken Grotesk", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      borderRadius: {
        DEFAULT: "10px",
        md: "8px",
        lg: "10px",
        xl: "12px",
      },
      keyframes: {
        "border-trail": {
          "0%": { offsetDistance: "0%" },
          "100%": { offsetDistance: "100%" },
        },
        "epicenter-pulse": {
          "0%": { transform: "scale(0.8)", opacity: "0.8" },
          "50%": { transform: "scale(1.8)", opacity: "0.3" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
        "trail-rotate": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "border-trail": "border-trail 8s linear infinite",
        "epicenter": "epicenter-pulse 1.8s cubic-bezier(0, 0, 0.2, 1) forwards",
        "trail-rotate": "trail-rotate 6s linear infinite",
      },
    },
  },
  plugins: [],
}
