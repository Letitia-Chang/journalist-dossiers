import { useState } from 'react';
import { FileDown, FileText, MessageSquare, Users } from 'lucide-react';
import { downloadExport } from '../api';

type ExportType = 'journalists' | 'articles' | 'outreach';

export default function ExportPage() {
  const [downloading, setDownloading] = useState<ExportType | null>(null);

  const handleDownload = async (type: ExportType, filename: string) => {
    setDownloading(type);
    try {
      await downloadExport(type, filename);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Export Data</h1>
      <p className="text-slate-500 mb-8">Download your data as CSV files for use in spreadsheets or other tools.</p>

      <div className="space-y-4">
        <ExportCard
          icon={Users}
          title="Journalists"
          description="All journalist profiles including scores, contact info, and outreach status."
          onDownload={() => handleDownload('journalists', 'journalists.csv')}
          downloading={downloading === 'journalists'}
        />
        <ExportCard
          icon={FileText}
          title="Articles"
          description="All article records linked to journalists."
          onDownload={() => handleDownload('articles', 'articles.csv')}
          downloading={downloading === 'articles'}
        />
        <ExportCard
          icon={MessageSquare}
          title="Outreach Logs"
          description="All outreach history including messages, responses, and status."
          onDownload={() => handleDownload('outreach', 'outreach_logs.csv')}
          downloading={downloading === 'outreach'}
        />
      </div>
    </div>
  );
}

function ExportCard({ icon: Icon, title, description, onDownload, downloading }: any) {
  return (
    <div className="card p-5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-northstar-50 rounded-lg flex items-center justify-center">
          <Icon className="w-5 h-5 text-northstar-600" />
        </div>
        <div>
          <div className="font-medium text-slate-900">{title}</div>
          <div className="text-sm text-slate-500">{description}</div>
        </div>
      </div>
      <button onClick={onDownload} disabled={downloading} className="btn-primary shrink-0 disabled:opacity-50">
        <FileDown className="w-4 h-4" /> {downloading ? 'Downloading…' : 'Download CSV'}
      </button>
    </div>
  );
}
