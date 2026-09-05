import { useEffect, useRef, type ReactNode } from 'react';
import { X, LoaderCircle, Copy, ArrowUpRight, Layers3 } from 'lucide-react';

export const Status_names: Record<string, string> = { queued: '排队中', running: '处理中', succeeded: '已完成', failed: '失败', cancelled: '已取消' };

/** @brief 显示带文字和状态颜色的任务标记。 */
export function Status_badge({ status }: { status: string }) {
  return <span className={`status ${status}`}><i />{Status_names[status] ?? status}</span>;
}
/** @brief 用统一图形表现应用入口。 */
export function Brand_mark() { return <span className="brand-mark"><Layers3 size={23} strokeWidth={1.5} /></span>; }
/** @brief 显示空数据说明及下一步入口。 */
export function Empty_state({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Layers3 size={26} strokeWidth={1.2} /></span><h3>{title}</h3><p>{detail}</p>{action}</div>;
}
/** @brief 在提交中显示旋转图标，避免重复提交。 */
export function Busy_icon() { return <LoaderCircle size={16} className="spin" />; }
/** @brief 提供带焦点约束、Escape 关闭及焦点恢复的原生对话框。 */
export function Modal({ title, subtitle, children, close }: { title: string; subtitle?: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} className="modal" onCancel={close} aria-labelledby="modal-title" onClick={event => { if (event.target === ref.current) close(); }}>
    <div className="modal-content"><div className="modal-head"><div><span className="eyebrow">MODEL ATELIER</span><h2 id="modal-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      <button className="icon-button" onClick={close} aria-label="关闭对话框"><X size={20} /></button></div>{children}</div>
  </dialog>;
}
/** @brief 复制文本并通过通知反馈操作结果。 */
export function Copy_button({ value, notify, label = '复制' }: { value: string; notify: (message: string, error?: boolean) => void; label?: string }) {
  return <button className="button small ghost" onClick={async () => { try { await navigator.clipboard.writeText(value); notify('已复制到剪贴板'); } catch { notify('复制失败，请手动选择内容复制', true); } }}><Copy size={14} />{label}</button>;
}
/** @brief 显示页面标题、说明和主要操作。 */
export function Page_heading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}<span className="title-dot">.</span></h1><p>{description}</p></div>{action}</div>;
}
/** @brief 提供面板内轻量导航链接。 */
export function Text_link({ children, click }: { children: ReactNode; click: () => void }) { return <button className="text-link" onClick={click}>{children}<ArrowUpRight size={15} /></button>; }
