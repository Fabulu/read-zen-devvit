// Curated "Start here" list for the composer — classic Wumenguan (無門關) koans.
// Every route is a real gongan line-range derived from the OpenZenTexts source
// (pd.wumenguan-1632) with the ReadZen community (Fabulu) translation, verified
// to round-trip through parseRoute and to resolve to the intended passage. Routes
// span the FULL case: the dialogue (公案), Wumen's commentary (無門曰), and the
// verse (頌曰) — start id wm32.caseNN.l01 through the last verse line — so each
// reads as the complete classic koan. Keep this short and hand-picked, not
// exhaustive.
export const CASES: {label: string; route: string}[] = [
  {
    label: "Zhaozhou's Dog",
    route: 'pd.wumenguan-1632/wm32.case01.l01-wm32.case01.verse.l04/Fabulu',
  },
  {
    label: 'Zhaozhou: Wash Your Bowl',
    route: 'pd.wumenguan-1632/wm32.case07.l01-wm32.case07.verse.l04/Fabulu',
  },
  {
    label: 'Dongshan: Three Pounds of Hemp',
    route: 'pd.wumenguan-1632/wm32.case18.l01-wm32.case18.verse.l04/Fabulu',
  },
  {
    label: 'Ordinary Mind is the Way',
    route: 'pd.wumenguan-1632/wm32.case19.l01-wm32.case19.verse.l04/Fabulu',
  },
  {
    label: "Yunmen's Dried Shit-Stick",
    route: 'pd.wumenguan-1632/wm32.case21.l01-wm32.case21.verse.l04/Fabulu',
  },
  {
    label: 'Not the Wind, Not the Flag',
    route: 'pd.wumenguan-1632/wm32.case29.l01-wm32.case29.verse.l04/Fabulu',
  },
  {
    label: 'This Very Mind is Buddha',
    route: 'pd.wumenguan-1632/wm32.case30.l01-wm32.case30.verse.l04/Fabulu',
  },
  {
    label: 'The Cypress Tree in the Courtyard',
    route: 'pd.wumenguan-1632/wm32.case37.l01-wm32.case37.verse.l04/Fabulu',
  },
]
