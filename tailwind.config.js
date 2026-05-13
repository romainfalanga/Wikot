/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{ts,tsx,js,jsx}',
    './public/**/*.{js,html}'
  ],
  theme: {
    extend: {
      colors: {
        // === PALETTE PREMIUM HÔTELLERIE ===
        brand: { 50:'#FBF7EE',100:'#F5ECD2',200:'#EBD8A4',300:'#DFC076',400:'#D4AC54',500:'#C9A961',600:'#A68845',700:'#7E682F',800:'#56481F',900:'#2E2611' },
        navy:  { 50:'#F4F6F9',100:'#E2E7EE',200:'#C2CCD9',300:'#94A3B8',400:'#5C7185',500:'#3A4F66',600:'#1F3147',700:'#162536',800:'#0F1B28',900:'#0A1628' },
        cream: { 50:'#FDFCF9',100:'#FAF8F5',200:'#F5F1EA',300:'#EDE7DB',400:'#DCD3C0',500:'#C8BCA3' },
        gold:  { 400:'#D4AC54',500:'#C9A961',600:'#A68845' },
        wine:  { 500:'#8B2635',600:'#6E1E2A',700:'#52171F' }
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        'premium-sm': '0 1px 2px rgba(15,27,40,0.04), 0 1px 3px rgba(15,27,40,0.06)',
        'premium':    '0 4px 12px rgba(15,27,40,0.06), 0 1px 3px rgba(15,27,40,0.04)',
        'premium-lg': '0 8px 24px rgba(15,27,40,0.08), 0 2px 6px rgba(15,27,40,0.04)',
        'premium-xl': '0 16px 40px rgba(15,27,40,0.10), 0 4px 12px rgba(15,27,40,0.05)'
      }
    }
  },
  // Comme le HTML est généré dynamiquement (template strings dans les modules JS),
  // on garde une safelist pour les patterns qui pourraient être supprimés par le purge.
  safelist: [
    // Couleurs dynamiques fréquentes
    { pattern: /^(bg|text|border|ring)-(navy|gold|cream|brand|wine|red|green|blue|yellow|orange|purple|pink|emerald|amber|slate|gray|zinc|stone|neutral)-(50|100|200|300|400|500|600|700|800|900)$/ },
    // Tailles dynamiques courantes
    { pattern: /^(w|h|min-h|max-h|min-w|max-w)-(0|1|2|3|4|5|6|7|8|9|10|11|12|14|16|20|24|28|32|36|40|44|48|52|56|60|64|72|80|96|full|screen|auto)$/ },
    // Display/flex
    'hidden','block','inline','inline-block','flex','inline-flex','grid','inline-grid',
    'lg:hidden','lg:block','lg:flex','lg:grid','sm:hidden','sm:block','sm:flex','md:hidden','md:block','md:flex',
    // Animations
    'animate-spin','animate-pulse','animate-bounce','animate-ping',
    // Opacity
    { pattern: /^opacity-(0|5|10|20|25|30|40|50|60|70|75|80|90|95|100)$/ }
  ]
}
