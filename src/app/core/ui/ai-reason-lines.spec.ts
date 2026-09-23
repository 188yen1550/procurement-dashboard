/** 檔案用途：驗證 AI 條列文字拆分規則（含 2026-09-23 分支整併吸收的標記格式與誤判防護）。 */
import { splitAiReasonLines } from './ai-reason-lines';

describe('splitAiReasonLines', () => {
  it('空值回傳空陣列', () => {
    expect(splitAiReasonLines(null)).toEqual([]);
    expect(splitAiReasonLines(undefined)).toEqual([]);
    expect(splitAiReasonLines('   ')).toEqual([]);
  });

  it('已有換行（含 CRLF）時直接依換行拆', () => {
    expect(splitAiReasonLines('第一點\r\n第二點\n\n第三點')).toEqual(['第一點', '第二點', '第三點']);
  });

  it('同一行的「1. 2. 3.」編號可拆開，且不會切開小數', () => {
    expect(splitAiReasonLines('1. 客群匹配僅 14.29 分。 2. 總分 50.25 分偏低。 3. 建議觀察')).toEqual([
      '1. 客群匹配僅 14.29 分。',
      '2. 總分 50.25 分偏低。',
      '3. 建議觀察',
    ]);
  });

  it('支援「1、」「1）」與全形數字編號', () => {
    expect(splitAiReasonLines('1、毛利偏低 2、供應不穩')).toEqual(['1、毛利偏低', '2、供應不穩']);
    expect(splitAiReasonLines('１）缺貨 ２）客訴')).toEqual(['１）缺貨', '２）客訴']);
  });

  it('多位數編號視為一個整體，不會在 1 與 0 之間切開', () => {
    const text = Array.from({ length: 11 }, (_, i) => `${i + 1}. 第${i + 1}點`).join(' ');
    const lines = splitAiReasonLines(text);
    expect(lines).toHaveLength(11);
    expect(lines[9]).toBe('10. 第10點');
  });

  it('內文中不從 1 開始的數字不會被當成編號', () => {
    expect(splitAiReasonLines('適合 3、4 月檔期推出，備貨 2) 批')).toEqual(['適合 3、4 月檔期推出，備貨 2) 批']);
  });

  it('編號前的前言自成一行', () => {
    expect(splitAiReasonLines('整體評估：1. 毛利佳 2. 供應穩')).toEqual(['整體評估：', '1. 毛利佳', '2. 供應穩']);
  });

  it('以項目符號開頭時依符號拆分', () => {
    expect(splitAiReasonLines('• 缺貨風險 • 客訴風險')).toEqual(['• 缺貨風險', '• 客訴風險']);
    expect(splitAiReasonLines('- 缺貨風險 - 客訴風險')).toEqual(['- 缺貨風險', '- 客訴風險']);
  });

  it('句中的「 - 」（減號／破折號）不會被拆開', () => {
    expect(splitAiReasonLines('毛利 = 售價 - 成本 - 運費，仍偏低')).toEqual(['毛利 = 售價 - 成本 - 運費，仍偏低']);
  });
});
