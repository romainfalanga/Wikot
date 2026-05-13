/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{ts,tsx,js,jsx}',
    './public/**/*.{js,html}'
  ],
  theme: {
    extend: {
      colors: {
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
  // ============================================================
  // SAFELIST — CRITIQUE pour les classes responsive et dynamiques
  // ============================================================
  // Le scanner Tailwind ne détecte pas correctement les classes
  // dans les template strings JS, surtout les classes responsive
  // composées (lg:hidden, sm:grid-cols-2, etc.). On les whitelist
  // explicitement, en restant raisonnable sur la taille du CSS.
  // ============================================================
  safelist: [
    // --- DISPLAY responsive (TRÈS critique pour mobile) ---
    'sm:hidden','sm:block','sm:inline','sm:inline-block','sm:flex','sm:inline-flex','sm:grid','sm:flex-row','sm:flex-col',
    'md:hidden','md:block','md:flex','md:grid','md:flex-row','md:flex-col',
    'lg:hidden','lg:block','lg:flex','lg:grid','lg:flex-row','lg:flex-col','lg:inline','lg:inline-flex','lg:inline-block',
    'xl:hidden','xl:block','xl:flex','xl:grid',

    // --- POSITION / Z-INDEX responsive ---
    'lg:relative','lg:absolute','lg:fixed','lg:sticky','lg:static',
    'lg:z-auto','lg:z-0','lg:z-10','lg:z-20','lg:z-30','lg:z-40','lg:z-50',

    // --- ITEMS / JUSTIFY / SELF responsive ---
    'sm:items-center','sm:items-start','sm:items-end','sm:items-stretch',
    'sm:justify-start','sm:justify-end','sm:justify-center','sm:justify-between',
    'sm:self-auto','sm:self-start','sm:self-end','sm:self-center','sm:self-stretch',
    'sm:shrink-0','lg:shrink-0',
    'order-1','order-2','order-3','order-4','lg:order-1','lg:order-2','lg:order-3','lg:order-4',

    // --- GAP responsive ---
    'sm:gap-1','sm:gap-2','sm:gap-3','sm:gap-4','sm:gap-5','sm:gap-6',
    'md:gap-2','md:gap-3','md:gap-4','md:gap-5','md:gap-6',
    'lg:gap-2','lg:gap-3','lg:gap-4','lg:gap-5','lg:gap-6','lg:gap-8',
    'sm:space-y-4','sm:space-y-5','sm:space-y-6','sm:space-y-8',

    // --- PADDING / MARGIN responsive (TRÈS utilisés) ---
    'sm:p-3','sm:p-4','sm:p-5','sm:p-6','sm:p-7','sm:p-8','sm:p-9',
    'sm:px-4','sm:px-5','sm:px-6','sm:py-2','sm:py-3','sm:py-4','sm:pr-4','sm:pb-4','sm:pb-5',
    'sm:-mx-5','sm:-mb-5','sm:-mx-4','sm:mb-6','sm:mb-9',
    'md:p-6','md:px-6','md:-mx-6',
    'lg:p-6','lg:p-8','lg:p-12','lg:px-6','lg:px-8','lg:-mx-6','lg:-mx-8',
    'xl:p-16',

    // --- WIDTH / HEIGHT responsive ---
    'sm:h-12','sm:w-12','sm:w-11','sm:h-11',
    'sm:max-w-md','sm:max-w-lg','sm:max-w-xl','sm:max-w-2xl','sm:max-w-3xl','sm:max-w-4xl','sm:max-w-5xl','sm:max-w-6xl','sm:max-w-7xl',
    'lg:w-1/2','lg:w-1/3','lg:w-2/3','lg:w-1/4','lg:w-3/4','lg:w-full','lg:w-64','lg:w-72','lg:w-80','lg:w-96',
    'lg:min-w-0','lg:flex-1',
    'xl:w-96',

    // --- TYPOGRAPHY responsive ---
    'sm:text-xs','sm:text-sm','sm:text-base','sm:text-lg','sm:text-xl','sm:text-2xl','sm:text-3xl','sm:text-4xl',
    'lg:text-xl','lg:text-2xl','lg:text-3xl','lg:text-4xl','lg:text-5xl',
    'xl:text-4xl','xl:text-5xl','xl:text-6xl',

    // --- GRID responsive (critique) ---
    'sm:grid-cols-1','sm:grid-cols-2','sm:grid-cols-3','sm:grid-cols-4','sm:grid-cols-5','sm:grid-cols-6','sm:grid-cols-9',
    'md:grid-cols-1','md:grid-cols-2','md:grid-cols-3','md:grid-cols-4','md:grid-cols-5','md:grid-cols-6',
    'lg:grid-cols-1','lg:grid-cols-2','lg:grid-cols-3','lg:grid-cols-4','lg:grid-cols-5','lg:grid-cols-6','lg:grid-cols-8','lg:grid-cols-9','lg:grid-cols-12',
    'xl:grid-cols-2','xl:grid-cols-3','xl:grid-cols-4','xl:grid-cols-5','xl:grid-cols-6',
    'lg:col-span-1','lg:col-span-2','lg:col-span-3','lg:col-span-4','lg:col-span-5','lg:col-span-6','lg:col-span-7','lg:col-span-8','lg:col-span-9','lg:col-span-10','lg:col-span-11','lg:col-span-12',
    'md:col-span-2','md:col-span-3','xl:col-span-3','xl:col-span-4',

    // --- TRANSFORMS critique pour sidebar mobile ---
    // ⚠️ BUG CRITIQUE : si on whiteliste juste -translate-x-full SANS aussi
    // 'transform', Tailwind compile la règle SANS la propriété `transform`
    // de base (juste la variable --tw-translate-x), donc la translation
    // n'est PAS appliquée → la sidebar reste à sa position d'origine.
    // Solution : whitelister 'transform' aussi pour forcer la règle complète.
    'transform','transform-none','transform-gpu',
    'translate-x-0','-translate-x-full','translate-x-full','translate-x-1','translate-x-2','translate-x-3','translate-x-4',
    'translate-y-0','-translate-y-1','-translate-y-2','translate-y-1','translate-y-2',
    'lg:translate-x-0','lg:translate-x-full','lg:-translate-x-full',
    'scale-95','scale-100','scale-105','scale-110',
    'rotate-0','rotate-45','rotate-90','rotate-180','-rotate-45','-rotate-90',

    // --- HOVER / FOCUS dynamiques ---
    'hover:bg-white/10','hover:scale-105','hover:scale-110','hover:translate-x-0.5',
    'focus:outline-none','focus:ring-2','focus:ring-offset-2',

    // --- ANIMATIONS ---
    'animate-spin','animate-pulse','animate-bounce','animate-ping',

    // --- COULEURS dynamiques très utilisées (rouge/vert/jaune/violet/bleu pour badges/toasts) ---
    { pattern: /^(bg|text|border|ring)-(red|green|blue|yellow|orange|purple|pink|emerald|amber|slate|gray|sky|indigo|violet|rose)-(50|100|200|300|400|500|600|700|800|900)$/ },
    // Tailwind couleurs custom (brand/navy/cream/gold/wine)
    { pattern: /^(bg|text|border|ring)-(brand|navy|cream|gold|wine)-(50|100|200|300|400|500|600|700|800|900)$/ },
    // Hover/focus pour ces couleurs (variantes critiques uniquement)
    { pattern: /^hover:(bg|text|border)-(red|green|blue|yellow|orange|purple|pink|emerald|amber|slate|gray|sky|indigo)-(100|200|300|400|500|600|700)$/ },

    // --- OPACITY dynamique ---
    { pattern: /^opacity-(0|5|10|20|25|30|40|50|55|60|70|75|80|90|95|100)$/ },
  ]
}
