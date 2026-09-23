/**
 * 檔案用途：把後端回傳的單一字串 AI 文字（推薦原因、高風險提示等 LLM
 * 條列式輸出），拆成條列陣列，供畫面用 <ul><li> 逐行呈現。
 *
 * 背景：後端 aiReasons 是單一字串（Gemini JSON Schema 把 reasons 定義成
 * STRING，提示詞只用文字要求「條列式」），換行方式由模型自由發揮：
 * 理想情況下每點之間用 \n 分隔，但實務上 LLM 有時會把多點寫在同一行，例如：
 *   「1. 核心客群匹配度僅 14.29 分…。 2. 綜合加權總分 50.25 分偏低…。 3. …」
 *   「1、毛利偏低 2、供應不穩」「• 缺貨風險 • 客訴風險」
 * 這種情況下用 \n 拆完仍是單一元素陣列，畫面上仍會擠成一整段。
 *
 * 為什麼不能單純用「。」句號當拆分依據：
 * 1. 單一點本身就可能包含不只一句話（內部有多個句號），用句號切會把
 *    同一點錯誤拆成好幾行，語意上是不對的。
 * 2. 句號無法保留「這是第幾點」的編號資訊。
 * 真正可靠的「新的一點開始了」訊號是 LLM 自己輸出的編號或符號標記。
 *
 * 策略：
 * 1. 優先用 \n 拆；能拆出兩行以上，直接採用（相信既有換行格式）。
 * 2. 沒有換行時，偵測編號標記「1. 」「1、」「1)」「1）」（含全形數字），
 *    ⚠️ 只接受「從 1 開始、依序遞增」的編號序列——避免把內文裡的
 *    「適合 3、4 月檔期」「版本 2) 」這類非編號數字誤判成新的一點。
 *    多位數編號（10. 11. …）也必須當成一個整體，不能在 1 與 0 之間切開。
 * 3. 沒有編號時，只有在整段文字「本身就以項目符號開頭」時才用項目符號
 *    （• ‧ ◦ ・ - *）拆分——句中的「 - 」很常是減號或破折號
 *    （例如「售價 - 成本」），不能在任意位置看到就切。
 * 4. 以上都拆不出多行時，整段字串當成單一點（合理的降級，不是錯誤）。
 *
 * 2026-09-23 分支整併：procurement-dashboard-updated 分支另外寫了一份
 * core/domain/ai-text.ts（splitAiTextIntoPoints）處理同一件事。整併時
 * 只保留這一份（既有呼叫端最多），把分支版本多支援的標記格式吸收進來，
 * 但不沿用它「句中任意位置的 - 都當項目符號」的規則，理由見第 3 點。
 */

/** 編號標記：1-2 位數（半形或全形）＋「. 」（點後必須有空白，避免小數 14.29）或「、」「)」「）」。 */
const NUMBERED_MARKER = /(?<![0-9０-９.])([0-9０-９]{1,2})(?:\.(?=\s)|[、)）])/g;

/** 可接受的項目符號；「-」「*」必須後接空白才算，避免 -5% 之類的數值。 */
const BULLET_START = /^([•‧◦・]|[-*](?=\s))/;

export function splitAiReasonLines(raw: string | null | undefined): string[] {
  if (!raw) return [];

  const trimmed = raw.replace(/\r\n/g, '\n').trim();
  if (!trimmed) return [];

  const byNewline = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (byNewline.length > 1) return byNewline;

  const byNumber = splitByNumberedMarkers(trimmed);
  if (byNumber.length > 1) return byNumber;

  const byBullet = splitByLeadingBullet(trimmed);
  if (byBullet.length > 1) return byBullet;

  return [trimmed];
}

function toHalfWidthNumber(digits: string): number {
  return Number(digits.replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 0xff10)));
}

/** 只在「1、2、3…依序遞增」的編號位置切開，其餘數字一律視為內文。 */
function splitByNumberedMarkers(text: string): string[] {
  const cutPositions: number[] = [];
  let expected = 1;
  for (const match of text.matchAll(NUMBERED_MARKER)) {
    if (toHalfWidthNumber(match[1]) === expected) {
      cutPositions.push(match.index ?? 0);
      expected++;
    }
  }
  if (cutPositions.length < 2) return [text];

  const pieces: string[] = [];
  // 第一個編號前面若有前言（例如「整體評估：1. …」），前言自成一行，不丟棄。
  const boundaries = cutPositions[0] === 0 ? cutPositions : [0, ...cutPositions];
  for (let i = 0; i < boundaries.length; i++) {
    pieces.push(text.slice(boundaries[i], boundaries[i + 1]).trim());
  }
  return pieces.filter((piece) => piece.length > 0);
}

/** 整段以項目符號開頭時，才在「空白＋同一個符號＋（空白）」的位置切開。 */
function splitByLeadingBullet(text: string): string[] {
  const start = BULLET_START.exec(text);
  if (!start) return [text];
  const marker = start[1].replace(/[-*]/, '\\$&');
  const needsSpaceAfter = /[-*]/.test(start[1]);
  const separator = new RegExp(`\\s+(?=${marker}${needsSpaceAfter ? '\\s' : ''})`);
  return text
    .split(separator)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}
