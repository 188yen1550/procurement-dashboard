/**
 * 檔案用途：把後端回傳的單一字串 AI 推薦原因，拆成條列陣列。
 *
 * 背景：後端 aiReasons 是單一字串，理想情況下每點之間會用 \n 分隔，
 * 但實務上 LLM 有時會把多點寫在同一行，例如：
 *   「1. 核心客群匹配度僅 14.29 分…。 2. 綜合加權總分 50.25 分偏低…。 3. …」
 * 這種情況下用 \n 拆完仍是單一元素陣列，畫面上仍會擠成一整段，沒有真正換行。
 *
 * 為什麼不能單純用「。」句號當拆分依據：
 * 1. 單一點本身就可能包含不只一句話（內部有多個句號），用句號切會把
 *    同一點錯誤拆成好幾行，語意上是不對的。
 * 2. 句號無法保留「這是第幾點」的編號資訊。
 * 3. 「。」是全形句號，跟數字小數點用的半形「.」（如 14.29、50.25）
 *    不會混淆，所以句號本身在技術上是「安全」的分隔字元，但安全不代表
 *    語意正確——真正可靠的「新的一點開始了」訊號是 LLM 自己輸出的編號
 *    標記（「1. 」「2. 」…），不是句號。
 *
 * 因此策略是：
 * 1. 優先用 \n 拆；若能拆出兩行以上，直接採用（相信既有換行格式）。
 * 2. 若沒有換行，退而偵測「數字 + 點 + 空白」這種編號標記，在每個標記前
 *    切開，藉此還原每一點的邊界。
 * 3. 兩者都拆不出多行時，整段字串當成單一點。
 */
const NUMBERED_MARKER = /(?=\d+\.\s)/;

export function splitAiReasonLines(raw: string | null | undefined): string[] {
  if (!raw) return [];

  const trimmed = raw.trim();
  if (!trimmed) return [];

  const byNewline = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (byNewline.length > 1) return byNewline;

  const byNumberedMarker = trimmed
    .split(NUMBERED_MARKER)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (byNumberedMarker.length > 1) return byNumberedMarker;

  return [trimmed];
}
