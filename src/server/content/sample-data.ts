import type {RenderedContent} from '../../shared/api.ts'

// Bundled sample: Wumenguan Case 1 (趙州狗子 / Zhaozhou's Dog). Authentic ZH from
// OpenZenTexts (pd/wumenguan-1632) + the ReadZen community (Fabulu) translation.
// Renders the reader honestly until the live GitHub fetch is approved — this maps
// 1:1 to the file the live provider will fetch, so the flip is invisible.
export const SAMPLE_ROUTE =
  'pd.wumenguan-1632/wm32.case01.l01-wm32.case01.l02/en/Fabulu'

export const SAMPLE_CASE_01: RenderedContent = {
  kind: 'case',
  workId: 'pd.wumenguan-1632',
  title: "Zhaozhou's Dog",
  titleZh: '趙州狗子',
  caseLabel: 'Case 1',
  lines: [
    {
      id: 'wm32.case01.l01',
      role: 'case',
      zh: '趙州和尚因僧問：狗子還有佛性也無。',
      en: 'A monk asked Master Zhaozhou: Does a dog also have buddha-nature or not?',
    },
    {
      id: 'wm32.case01.l02',
      role: 'case',
      zh: '州云：無。',
      en: 'Zhaozhou said: No.',
    },
  ],
  attribution: {
    work: 'The Gateless Gate',
    workZh: '無門關',
    cbetaId: 'T48n2005',
    master: 'Zhaozhou Congshen',
    translator: 'ReadZen community (Fabulu)',
    license: 'CC BY-SA 4.0',
  },
  rzLink: `https://readzen.pages.dev/#/${SAMPLE_ROUTE}`,
  zenUri: `zen://${SAMPLE_ROUTE}`,
}
