import { RefreshCw, Trash2 } from "lucide-react";
import {
  clearHistory,
  removeHistoryItem,
  type PromptHistoryItem
} from "../../lib/storage";

interface HistoryListProps {
  items: PromptHistoryItem[];
  onRefresh: () => void | Promise<void>;
  onSelect: (item: PromptHistoryItem) => void;
  onChanged: (items: PromptHistoryItem[]) => void;
}

export function HistoryList({
  items,
  onRefresh,
  onSelect,
  onChanged
}: HistoryListProps) {
  async function deleteItem(id: string) {
    onChanged(await removeHistoryItem(id));
  }

  async function clearAll() {
    await clearHistory();
    onChanged([]);
  }

  return (
    <main className="history-view">
      <div className="section-header">
        <div>
          <h2>历史记录</h2>
          <p>最多保留最近 20 条 Prompt</p>
        </div>
        <div className="button-row compact">
          <button type="button" title="刷新" onClick={onRefresh}>
            <RefreshCw size={16} />
          </button>
          <button type="button" title="清空历史" onClick={clearAll} disabled={!items.length}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <section className="empty-state">暂无历史记录</section>
      ) : (
        <div className="history-list">
          {items.map((item) => (
            <article className="history-item" key={item.id}>
              <button
                className="history-main"
                type="button"
                onClick={() => onSelect(item)}
              >
                {item.thumbnail ? (
                  <img src={item.thumbnail} alt="" />
                ) : (
                  <span className="history-thumb-placeholder" />
                )}
                <span>
                  <strong>{item.summaryTitle}</strong>
                  <small>{item.summarySubtitle || item.rawPromptText}</small>
                  <time>{formatDate(item.createdAt)}</time>
                </span>
              </button>
              <button
                className="icon-danger"
                type="button"
                title="删除"
                onClick={() => deleteItem(item.id)}
              >
                <Trash2 size={15} />
              </button>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
