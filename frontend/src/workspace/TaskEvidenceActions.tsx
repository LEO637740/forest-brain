import { useState } from 'react';
import type { FleetSnapshot } from '../zoneFleet';
import type { Task } from './model';
import { createTaskEvidenceSnapshot, taskEvidenceArtifact } from './taskEvidenceExport';
import type {OperationalEvent} from './operationalEvents';
import type {LatexBatch} from '../../../shared/logistics';

type ExportNotice = { kind: 'success' | 'error'; message: string } | null;

export function TaskEvidenceActions({ task, fleet, events = [], batches = [] }: { task: Task; fleet: FleetSnapshot; events?: OperationalEvent[]; batches?: LatexBatch[] }) {
  const [notice, setNotice] = useState<ExportNotice>(null);

  function exportRecord(format: 'html' | 'json') {
    setNotice(null);
    let url: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      const snapshot = createTaskEvidenceSnapshot(task, fleet, Date.now(), events, batches);
      const artifact = taskEvidenceArtifact(snapshot, format);
      url = URL.createObjectURL(new Blob([artifact.content], { type: artifact.mimeType }));
      link = document.createElement('a');
      link.href = url;
      link.download = artifact.filename;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      const downloadedUrl = url;
      setTimeout(() => URL.revokeObjectURL(downloadedUrl), 1000);
      url = undefined;
      setNotice({ kind: 'success', message: `已生成${format === 'html' ? '核对单' : '原始记录'}，请在浏览器下载中查看。` });
    } catch (error) {
      setNotice({ kind: 'error', message: `导出失败：${error instanceof Error ? error.message : '无法生成文件，请重试。'}` });
    } finally {
      link?.remove();
      if (url) URL.revokeObjectURL(url);
    }
  }

  return <section className="op-evidence-export" aria-label="导出当前任务记录">
    <details>
      <summary>导出与留档</summary>
      <p>导出浏览器当前快照：核对单为可打印的 HTML，原始记录为 JSON。</p>
    <div className="op-evidence-export-actions">
      <button type="button" onClick={() => exportRecord('html')}>导出核对单</button>
      <button type="button" onClick={() => exportRecord('json')}>导出原始记录</button>
    </div>
    </details>
    {notice && <p className={`op-evidence-export-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</p>}
  </section>;
}
