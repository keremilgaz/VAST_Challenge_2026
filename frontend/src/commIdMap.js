// ============================================
// message_id → message number (comm_id) の全体マップ
// ============================================
// UI では responding_to（実体は message_id）を「#番号」で表示したい。
// backend/データ側は message_id をそのまま保持する（スレッド構築などが依存するため）。
// アプリ起動時に /api/message-id-map を1回ロードしてここに保持する。
export const commIdByMessageId = new Map();

export function loadCommIdMap(obj) {
  commIdByMessageId.clear();
  for (const [mid, num] of Object.entries(obj || {})) {
    if (num != null) commIdByMessageId.set(mid, num);
  }
}

// message_id を渡すと対応する番号を返す。無ければ null。
export function messageNumber(messageId) {
  if (!messageId) return null;
  const n = commIdByMessageId.get(messageId);
  return n == null ? null : n;
}
