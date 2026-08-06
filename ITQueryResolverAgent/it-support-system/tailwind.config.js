/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          950: "#05070d",
          900: "#0a0e1a",
          800: "#101526",
        },
        accent: {
          400: "#5eead4",
          500: "#22d3ee",
          600: "#0ea5e9",
        },
      },
      backdropBlur: { xs: "2px" },
      boxShadow: {
        glass: "0 8px 32px 0 rgba(0, 0, 0, 0.45)",
      },
      keyframes: {
        drift: {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(-2%, -1.5%, 0) scale(1.03)" },
        },
        driftReverse: {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1.02)" },
          "50%": { transform: "translate3d(2%, 1.5%, 0) scale(1)" },
        },
        pulseSlow: {
          "0%, 100%": { opacity: 1, transform: "scale(1)" },
          "50%": { opacity: 0.6, transform: "scale(1.08)" },
        },
        pulseSlower: {
          "0%, 100%": { opacity: 0.8, transform: "scale(1)" },
          "50%": { opacity: 0.45, transform: "scale(0.94)" },
        },
        scan: {
          "0%": { transform: "translateY(-20%)" },
          "100%": { transform: "translateY(120%)" },
        },
      },
      animation: {
        "drift-slow": "drift 22s ease-in-out infinite",
        "drift-slow-reverse": "driftReverse 26s ease-in-out infinite",
        "pulse-slow": "pulseSlow 9s ease-in-out infinite",
        "pulse-slower": "pulseSlower 13s ease-in-out infinite",
        scan: "scan 7s linear infinite",
      },
    },
  },
  plugins: [],
};
